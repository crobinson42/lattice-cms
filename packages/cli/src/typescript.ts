import { createRequire } from 'node:module';
import { join } from 'node:path';
import type * as TS from 'typescript';
import { Exit } from './exit.js';

export type TypeScript = typeof TS;

/** The oldest TypeScript the CLI's peer range takes. */
const oldest = { major: 5, minor: 8 };

/**
 * The first major the CLI cannot use. TypeScript 7 is the native compiler:
 * its package has no JavaScript API, so nothing can parse a file with it.
 */
const native = 7;

// The guard checks the function the CLI calls first. A package named
// typescript that has it, at a version in the range, is taken for the
// compiler.
function isTypeScript(value: unknown): value is TypeScript {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createSourceFile' in value &&
    typeof value.createSourceFile === 'function'
  );
}

/** The `major.minor` a typescript package reports, if it reports one. */
function versionOf(value: unknown): string | undefined {
  return typeof value === 'object' &&
    value !== null &&
    'versionMajorMinor' in value &&
    typeof value.versionMajorMinor === 'string'
    ? value.versionMajorMinor
    : undefined;
}

/**
 * The app's own TypeScript, resolved from its directory, so the CLI parses
 * the app's code with the compiler the app builds it with. Older than 5.8
 * is refused, and so is 7, which has no JavaScript API.
 */
export function loadTypeScript(root: string): TypeScript {
  const require = createRequire(join(root, 'package.json'));
  let loaded: unknown;
  try {
    loaded = require('typescript');
  } catch {
    throw new Exit(
      `typescript is not installed in ${root}: run npm install --save-dev typescript@^6`,
      1,
    );
  }
  const version = versionOf(loaded);
  if (version === undefined) {
    throw new Exit(`the typescript package in ${root} is not TypeScript`, 1);
  }
  const [major = 0, minor = 0] = version.split('.').map(Number);
  if (
    major < oldest.major ||
    (major === oldest.major && minor < oldest.minor)
  ) {
    throw new Exit(
      `typescript ${version} in ${root} is too old: lattice needs ${oldest.major}.${oldest.minor} or later`,
      1,
    );
  }
  if (major >= native) {
    throw new Exit(
      `typescript ${version} in ${root} is the native compiler, which has no JavaScript API to parse files with: run npm install --save-dev typescript@^6`,
      1,
    );
  }
  if (!isTypeScript(loaded)) {
    throw new Exit(`the typescript package in ${root} is not TypeScript`, 1);
  }
  return loaded;
}
