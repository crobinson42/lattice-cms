import { constants, existsSync } from 'node:fs';
import {
  access,
  chmod,
  link,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { diff } from './diff.js';
import { applyInserts, type FileEdit } from './edit.js';
import { Exit } from './exit.js';

/** A file to create or edit, with its text before and after. */
export type Change = {
  readonly path: string;
  readonly before: string | undefined;
  readonly after: string;
};

/** A path from the app's root, with forward slashes, as output names it. */
export const shown = (root: string, path: string) =>
  relative(root, path).split(sep).join('/');

/** The import specifier for `to` from a file at `from`: relative, ending in `.js`. */
export function specifierOf(from: string, to: string): string {
  const path = relative(dirname(from), to)
    .split(sep)
    .join('/')
    .replace(/\.tsx?$/, '.js');
  return path.startsWith('.') ? path : `./${path}`;
}

/** The lines a refused edit would have added, and where, for each file. */
export function byHand(
  root: string,
  created: readonly Change[],
  edits: readonly FileEdit[],
) {
  return [
    'Nothing was written. Make these changes by hand, or fix the shape and run the command again:',
    ...created.map(
      (change) =>
        `${shown(root, change.path)}, a new file:\n${change.after.trimEnd()}`,
    ),
    ...edits.flatMap((edit) =>
      edit.additions.map(
        (addition) =>
          `${shown(root, edit.path)}, ${addition.where}:\n${addition.lines}`,
      ),
    ),
  ].join('\n\n');
}

/**
 * Writes every change, or none. Each new text is staged in a file beside
 * its target. Then each edited file must still hold the text that was
 * parsed and be writable, and each new file must still be absent. Then the
 * staged files take their targets' places: a rename for an edited file,
 * and a link, which never replaces a file, for a new one. On any failure
 * the staged files are removed and the files already placed are restored.
 */
async function writeAll(root: string, changes: readonly Change[]) {
  const staged: { readonly change: Change; readonly temp: string }[] = [];
  const placed: Change[] = [];
  let current = '';
  try {
    for (const change of changes) {
      current = change.path;
      const temp = join(
        dirname(change.path),
        `.${basename(change.path)}.lattice-${process.pid}.tmp`,
      );
      await writeFile(temp, change.after, { flag: 'wx' });
      staged.push({ change, temp });
      if (change.before !== undefined) {
        await chmod(temp, (await stat(change.path)).mode & 0o7777);
      }
    }
    for (const { change } of staged) {
      current = change.path;
      if (change.before === undefined) {
        if (existsSync(change.path)) {
          throw new Exit(`${shown(root, change.path)} already exists`, 1);
        }
      } else {
        await access(change.path, constants.W_OK);
        if ((await readFile(change.path, 'utf8')) !== change.before) {
          throw new Exit(
            `${shown(root, change.path)} changed while lattice ran; nothing was written`,
            1,
          );
        }
      }
    }
    for (const { change, temp } of staged) {
      current = change.path;
      if (change.before === undefined) {
        await link(temp, change.path);
        await rm(temp);
      } else {
        await rename(temp, change.path);
      }
      placed.push(change);
    }
  } catch (error) {
    await Promise.all(staged.map(({ temp }) => rm(temp, { force: true })));
    for (const change of placed.reverse()) {
      if (change.before === undefined) await rm(change.path, { force: true });
      else await writeFile(change.path, change.before);
    }
    if (error instanceof Exit) throw error;
    const code =
      error instanceof Error && 'code' in error ? ` (${error.code})` : '';
    throw new Exit(
      `cannot write ${shown(root, current)}${code}; nothing was written`,
      1,
    );
  }
}

/** The changes an edit makes: its file, before and after its inserts. */
export function changeOf(edit: FileEdit): Change {
  return {
    path: edit.path,
    before: edit.before,
    after: applyInserts(
      edit.before,
      edit.additions.flatMap((addition) => addition.inserts),
    ),
  };
}

/**
 * Refuses when an edit's file has no place for it, printing every change by
 * hand. Else prints each change as a diff on a dry run, or writes them all
 * and names each file.
 */
export async function apply(
  root: string,
  created: readonly Change[],
  edits: readonly FileEdit[],
  dryRun: boolean,
): Promise<void> {
  const refused = edits.flatMap((edit) =>
    edit.refused === undefined ? [] : [edit.refused],
  );
  if (refused.length > 0) {
    throw new Exit(refused.join('; '), 1, byHand(root, created, edits));
  }
  const changes = [...created, ...edits.map(changeOf)];
  if (dryRun) {
    for (const change of changes) {
      process.stdout.write(
        diff(shown(root, change.path), change.before, change.after),
      );
    }
    process.stdout.write('Dry run: nothing was written.\n');
    return;
  }
  await writeAll(root, changes);
  for (const change of changes) {
    process.stdout.write(
      `${change.before === undefined ? 'created' : 'edited'} ${shown(root, change.path)}\n`,
    );
  }
}
