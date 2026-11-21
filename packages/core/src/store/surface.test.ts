import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every module `entry` loads, following relative imports, and the packages
 * they import. Read from source, so it needs no build.
 */
function graph(entry: string) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const source = readFileSync(file, 'utf8');
    // Value imports only: `import type` and `export type` load nothing.
    for (const [, kind, specifier] of source.matchAll(
      /^(?:import|export)( type)?\s[^;]*?from '([^']+)';/gms,
    )) {
      if (kind !== undefined || specifier === undefined) continue;
      if (specifier.startsWith('.')) {
        visit(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')));
      } else {
        packages.add(specifier);
      }
    }
  };
  visit(entry);
  return { files, packages };
}

const here = dirname(fileURLToPath(import.meta.url));

describe('@latticecms/core/store', () => {
  it('loads no test code: neither node:assert nor the conformance suite', () => {
    const { files, packages } = graph(resolve(here, 'index.ts'));
    expect(
      [...packages].filter((name) => name.startsWith('node:assert')),
    ).toEqual([]);
    expect(files.has(resolve(here, 'conformance.ts'))).toBe(false);
  });

  it('the conformance suite does load node:assert', () => {
    // The check above can fail: it sees the suite's own imports.
    const { packages } = graph(resolve(here, 'conformance.ts'));
    expect(packages.has('node:assert/strict')).toBe(true);
  });
});
