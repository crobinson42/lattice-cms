import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The repository root: every quoted path is relative to it. */
const root = new URL('../../../', import.meta.url);

/** The READMEs whose quotes are checked. */
const readmes = [
  'packages/core/README.md',
  'packages/store-mongo/README.md',
  'packages/cli/README.md',
  'examples/crm/README.md',
];

/**
 * Each fenced block whose first line names a file, `// examples/crm/...`,
 * with the README line it starts on and the lines after the name.
 */
function quotes(readme: string) {
  const lines = readFileSync(new URL(readme, root), 'utf8').split('\n');
  const found: { line: number; path: string; body: string[] }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^```(ts|js)$/.test(lines[i] ?? '')) continue;
    const path = /^\/\/ ((?:packages|examples)\/\S+\.(?:ts|js))$/.exec(
      lines[i + 1] ?? '',
    )?.[1];
    const end = lines.indexOf('```', i + 1);
    if (path !== undefined) {
      found.push({ line: i + 2, path, body: lines.slice(i + 2, end) });
    }
    i = end;
  }
  return found;
}

/** The spaces a line starts with. */
function indent(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Whether `body` is a run of consecutive lines of `file`, with the same
 * indentation removed from each: an excerpt from inside a function is
 * quoted dedented.
 */
function contains(file: string[], body: string[]): boolean {
  const [first] = body;
  if (first === undefined) return true;
  return file.some((line, start) => {
    const removed = indent(line) - indent(first);
    if (removed < 0) return false;
    const prefix = ' '.repeat(removed);
    return body.every((quoted, offset) =>
      quoted === ''
        ? file[start + offset] === ''
        : file[start + offset] === prefix + quoted,
    );
  });
}

// A README quote that names its file must be that file's text, line for
// line, so a change to the code cannot leave the docs behind.
describe.each(readmes)('the quotes in %s', (readme) => {
  it('each match the file they name', () => {
    const stale = quotes(readme)
      .filter(({ path, body }) => {
        const file = readFileSync(new URL(path, root), 'utf8').split('\n');
        return !contains(file, body);
      })
      .map(({ line, path }) => `${readme}:${line} ${path}`);

    expect(stale).toEqual([]);
  });
});
