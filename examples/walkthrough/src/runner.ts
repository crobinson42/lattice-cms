import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type Step, stepsOf } from './readme.js';

/** The packages the walkthrough installs as tarballs, by directory. */
const published = ['core', 'store-mongo', 'admin', 'cli'];

/**
 * The environment every step runs in: the test's, without vitest's and
 * colors, and with `PORT=0`, so the server takes a free port.
 */
function environment(): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !key.startsWith('VITEST') &&
          key !== 'NODE_OPTIONS' &&
          key !== 'FORCE_COLOR',
      ),
    ),
    NO_COLOR: '1',
    PORT: '0',
  };
}

/**
 * Each published package as a tarball, by name, packed from a copy whose
 * version is 0.1.0: the first release's, so its internal peer ranges
 * resolve as they will on the registry.
 */
export async function pack(
  repo: string,
  out: string,
): Promise<Map<string, string>> {
  const tarballs = new Map<string, string>();
  for (const name of published) {
    const copy = join(out, 'packages', name);
    await cp(join(repo, 'packages', name), copy, {
      recursive: true,
      filter: (path) => !/[/\\](node_modules|fixtures)$/.test(path),
    });
    const manifestPath = join(copy, 'package.json');
    const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (typeof manifest !== 'object' || manifest === null) {
      throw new Error(`${manifestPath} is not an object`);
    }
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, version: '0.1.0' }, null, 2),
    );
    const packed = spawnSync(
      'npm',
      ['pack', '--silent', '--pack-destination', out],
      { cwd: copy, encoding: 'utf8' },
    );
    if (packed.status !== 0) {
      throw new Error(`npm pack ${name} failed:\n${packed.stderr}`);
    }
    const file = (await readdir(out)).find(
      (entry) =>
        entry.startsWith(`latticecms-${name}-`) && entry.endsWith('.tgz'),
    );
    if (file === undefined) throw new Error(`npm pack ${name} wrote nothing`);
    tarballs.set(`@latticecms/${name}`, join(out, file));
  }
  return tarballs;
}

/** `script` with each `@latticecms/*` install spec replaced by its tarball. */
export function withTarballs(
  script: string,
  tarballs: ReadonlyMap<string, string>,
): string {
  return script.replace(
    /(?<![\w/@-])@latticecms\/[a-z-]+(?![\w/-])/g,
    (spec) => tarballs.get(spec) ?? spec,
  );
}

/** The server a `start` block started, and how to stop it. */
export type Started = {
  readonly url: URL;
  readonly script: string;
  stop(): void;
};

function failed(readme: string, step: Step, detail: string): Error {
  return new Error(
    `${readme}:${step.line}: the ${step.kind} block failed\n${detail}`,
  );
}

/** Starts `script` in its own process group, and waits for the URL it prints. */
async function start(
  readme: string,
  step: Step & { readonly kind: 'start' },
  dir: string,
): Promise<Started> {
  const child: ChildProcess = spawn('sh', ['-c', step.script], {
    cwd: dir,
    env: environment(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stop = () => {
    if (child.pid !== undefined && child.exitCode === null) {
      process.kill(-child.pid, 'SIGTERM');
    }
  };
  let output = '';
  const url = await new Promise<URL>((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(failed(readme, step, `no URL within 30 s:\n${output}`));
    }, 30_000);
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      const found = /https?:\/\/\S+/.exec(output)?.[0];
      if (found !== undefined) {
        clearTimeout(timer);
        resolve(new URL(found));
      }
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(failed(readme, step, `exited ${code} before a URL:\n${output}`));
    });
  });
  const response = await fetch(url);
  if (!response.ok) {
    stop();
    throw failed(readme, step, `${url} answered ${response.status}`);
  }
  return { url, script: step.script, stop };
}

/**
 * Runs the README's `heading` section in `dir`: each block in order, with
 * `@latticecms/*` specs replaced by `tarballs` when given. It returns the
 * started server. A block that exits non-zero fails, naming its line.
 */
export async function runReadme(options: {
  readonly readme: string;
  readonly heading: string;
  readonly dir: string;
  readonly tarballs: ReadonlyMap<string, string> | undefined;
}): Promise<Started> {
  const { readme, dir, tarballs } = options;
  let started: Started | undefined;
  for (const step of stepsOf(readme, options.heading)) {
    if (step.kind === 'write') {
      const path = join(dir, step.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, step.text);
    } else if (step.kind === 'run') {
      const script =
        tarballs === undefined
          ? step.script
          : withTarballs(step.script, tarballs);
      const ran = spawnSync('sh', ['-e', '-c', script], {
        cwd: dir,
        env: environment(),
        encoding: 'utf8',
      });
      if (ran.status !== 0) {
        started?.stop();
        throw failed(
          readme,
          step,
          `exit ${ran.status}\n${ran.stdout}\n${ran.stderr}`,
        );
      }
    } else {
      if (started !== undefined) {
        started.stop();
        throw failed(readme, step, 'a second start block');
      }
      started = await start(readme, step, dir);
    }
  }
  if (started === undefined) {
    throw new Error(`${readme}: "${options.heading}" has no start block`);
  }
  return started;
}
