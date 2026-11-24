import { createRequire } from 'node:module';
import { join } from 'node:path';
import type * as TS from 'typescript';
import { Exit } from './exit.js';

export type TypeScript = typeof TS;

/** The oldest TypeScript the CLI's peer range takes. */
const oldest = { major: 5, minor: 8 };

// The guard checks the function the CLI calls first and the version it
// checks next. A package named typescript that has both is taken for the
// compiler.
function isTypeScript(value: unknown): value is TypeScript {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createSourceFile' in value &&
    typeof value.createSourceFile === 'function' &&
    'versionMajorMinor' in value &&
    typeof value.versionMajorMinor === 'string'
  );
}

/**
 * The app's own TypeScript, resolved from its directory, so the CLI parses
 * the app's code with the compiler the app builds it with. Older than 5.8
 * is refused.
 */
export function loadTypeScript(root: string): TypeScript {
  const require = createRequire(join(root, 'package.json'));
  let loaded: unknown;
  try {
    loaded = require('typescript');
  } catch {
    throw new Exit(
      `typescript is not installed in ${root}: run npm install --save-dev typescript`,
      1,
    );
  }
  if (!isTypeScript(loaded)) {
    throw new Exit(`the typescript package in ${root} is not TypeScript`, 1);
  }
  const [major = 0, minor = 0] = loaded.versionMajorMinor
    .split('.')
    .map(Number);
  if (
    major < oldest.major ||
    (major === oldest.major && minor < oldest.minor)
  ) {
    throw new Exit(
      `typescript ${loaded.versionMajorMinor} in ${root} is too old: lattice needs ${oldest.major}.${oldest.minor} or later`,
      1,
    );
  }
  return loaded;
}
