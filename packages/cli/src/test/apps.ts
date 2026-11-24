import { spawnSync } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

// Each test copies an app to a temp directory, links the workspace's
// node_modules into it, and runs the built bin with node, as a user would.

export const repo = fileURLToPath(new URL('../../../../', import.meta.url));
export const bin = join(repo, 'packages/cli/dist/bin.js');
export const fixture = join(repo, 'packages/cli/fixtures/app');
const temps: string[] = [];

/** Removes the temp directories the tests made. Call it in afterAll. */
export async function removeTemps(): Promise<void> {
  await Promise.all(
    temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
}

// Nested vitest runs read these, so the child runs get a clean
// environment, and plain output to match against.
export const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith('VITEST') &&
        key !== 'NODE_OPTIONS' &&
        key !== 'FORCE_COLOR',
    ),
  ),
  NO_COLOR: '1',
};

/** Runs node with `args` in `cwd`, with `extra` in its environment. */
export function run(
  cwd: string,
  args: readonly string[],
  extra: Readonly<Record<string, string>> = {},
) {
  const { status, stdout, stderr } = spawnSync(process.execPath, args, {
    cwd,
    env: { ...env, ...extra },
    encoding: 'utf8',
  });
  return { code: status, stdout, stderr };
}

export const lattice = (cwd: string, ...args: string[]) =>
  run(cwd, [bin, ...args]);

/**
 * A copy of the fixture app, or of `from`, at `at` below a temp root. The
 * workspace's node_modules is linked beside it, or, with `without`, every
 * package in it but that one.
 */
export async function copy(
  from = fixture,
  at = 'app',
  without?: string,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lattice-cli-'));
  temps.push(root);
  const app = join(root, at);
  await cp(from, app, {
    recursive: true,
    filter: (path) =>
      !/[/\\](node_modules|dist|\.turbo)$|\.tsbuildinfo$/.test(path),
  });
  const modules = join(repo, 'node_modules');
  if (without === undefined) {
    await symlink(modules, join(root, 'node_modules'));
    return app;
  }
  // Each top-level entry linked, and each entry of the scope `without` is
  // in, but `without`.
  const [scope = '', name] = without.split('/');
  for (const entry of await readdir(modules)) {
    if (entry !== scope) {
      await mkdir(join(root, 'node_modules'), { recursive: true });
      await symlink(join(modules, entry), join(root, 'node_modules', entry));
      continue;
    }
    await mkdir(join(root, 'node_modules', scope), { recursive: true });
    for (const scoped of await readdir(join(modules, scope))) {
      if (scoped === name) continue;
      await symlink(
        join(modules, scope, scoped),
        join(root, 'node_modules', scope, scoped),
      );
    }
  }
  return app;
}

/** Every file under `dir` and its text, but node_modules. */
export async function files(dir: string): Promise<Record<string, string>> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isFile() && !path.includes('node_modules')) {
      out[relative(dir, path)] = await readFile(path, 'utf8');
    }
  }
  return out;
}

export const read = (app: string, path: string) =>
  readFile(join(app, path), 'utf8');

/** Rewrites a file of the app. */
export async function edit(
  app: string,
  path: string,
  change: (text: string) => string,
) {
  await writeFile(join(app, path), change(await read(app, path)));
}

/** tsc, then vitest on `tests` with no config, in the app. */
export async function check(
  app: string,
  project: string,
  tests: readonly string[],
) {
  const tsc = run(app, [
    join(repo, 'node_modules/typescript/bin/tsc'),
    '-p',
    project,
  ]);
  expect(tsc.stdout).toBe('');
  expect(tsc.code).toBe(0);
  await writeFile(join(app, 'vitest.cli.config.mjs'), 'export default {};\n');
  const vitest = run(app, [
    join(repo, 'node_modules/vitest/vitest.mjs'),
    'run',
    '--config',
    'vitest.cli.config.mjs',
    ...tests,
  ]);
  expect(vitest.stdout).toContain(`Test Files  ${tests.length} passed`);
  expect(vitest.code).toBe(0);
}

/**
 * A copy of examples/crm, beside the workspace's tsconfig.base.json and
 * packages, which the crm's tsconfig extends and references.
 */
export async function crmCopy(): Promise<string> {
  const app = await copy(join(repo, 'examples/crm'), 'examples/crm');
  await cp(
    join(repo, 'tsconfig.base.json'),
    join(app, '../../tsconfig.base.json'),
  );
  await symlink(join(repo, 'packages'), join(app, '../../packages'));
  return app;
}
