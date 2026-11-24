import { call, objectEntry } from './layout.js';
import type { Names } from './names.js';

/** A string in single quotes. Labels hold only letters, digits, spaces and hyphens. */
const quote = (text: string) => `'${text}'`;

/** A new collection: a title field to start from, and its tenant and label. */
export function collectionText(
  names: Names,
  tenant: string | undefined,
  label: { readonly singular: string; readonly plural: string } | undefined,
): string {
  return [
    "import { collection } from '@latticecms/core';",
    "import { z } from 'zod';",
    '',
    ...call(
      '',
      `export const ${names.exportName} = collection`,
      [
        quote(names.slug),
        {
          expanded: true,
          lines: (indent) => [
            `${indent}schema: z.object({`,
            `${indent}  name: z.string().min(1),`,
            `${indent}}),`,
            ...(tenant === undefined
              ? []
              : [`${indent}tenant: ${quote(tenant)},`]),
            ...(label === undefined
              ? []
              : objectEntry(indent, 'label', [
                  `singular: ${quote(label.singular)}`,
                  `plural: ${quote(label.plural)}`,
                ])),
          ],
        },
      ],
      ';',
    ),
    '',
  ].join('\n');
}

/** An import of one name for the test, with the specifier that sorts it. */
export type TestImport = { readonly name: string; readonly specifier: string };

/** The names the test imports from packages, by whether the collection is tenanted. */
export function testPackageNames(tenanted: boolean): readonly string[] {
  return [
    'framework',
    'MemoryStore',
    tenanted ? 'tenancy' : 'unscoped',
    'describe',
    'expect',
    'it',
  ];
}

/**
 * The collection's test: it is in the app's contract, and it stores and
 * reads a document through a one-collection framework with the app's
 * family over `MemoryStore`. Without a composition export, only the second.
 */
export function testText(
  names: Names,
  tenanted: boolean,
  family: TestImport,
  app: TestImport | undefined,
  sort: (a: string, b: string) => number,
): string {
  const [framework, store, scoping, describe, expect, it] =
    testPackageNames(tenanted);
  const scope = tenanted ? 'scope' : 'unscoped';
  const local = [family, ...(app === undefined ? [] : [app])]
    .concat({ name: names.exportName, specifier: `./${names.file}.js` })
    .sort((a, b) => sort(a.specifier, b.specifier));
  const repo = `repos.${names.slug}`;
  return [
    `import { ${framework}, ${store}, ${scoping} } from '@latticecms/core';`,
    `import { ${describe}, ${expect}, ${it} } from 'vitest';`,
    ...local.map(
      ({ name, specifier }) => `import { ${name} } from '${specifier}';`,
    ),
    '',
    `describe(${quote(names.slug)}, () => {`,
    ...(app === undefined
      ? []
      : [
          "  it('is in the app', () => {",
          ...call(
            '    ',
            `expect(${app.name}.contract).toHaveProperty`,
            [quote(names.slug)],
            ';',
          ),
          '  });',
          '',
        ]),
    "  it('stores a document and reads it back', async () => {",
    ...call(
      '    ',
      'const { repos } = framework',
      [
        {
          expanded: false,
          lines: (indent) => [`${indent}family: ${family.name},`],
        },
      ],
      '',
    ),
    ...call(
      '      ',
      '.collection',
      [
        names.exportName,
        { expanded: false, lines: (indent) => [`${indent}access: {},`] },
      ],
      '',
    ),
    '      .build({',
    '        store: new MemoryStore(),',
    '        events: { publish: async (_event: object) => {} },',
    '      });',
    ...(tenanted
      ? call(
          '    ',
          'const scope = tenancy.scope',
          [names.exportName, "'tenant-1'"],
          ';',
        )
      : []),
    ...call(
      '    ',
      `const created = await ${repo}.insert`,
      ["{ name: 'First' }", scope],
      ';',
    ),
    ...call(
      '    ',
      'expect',
      [`await ${repo}.get(created.id, ${scope})`],
      '.toEqual(created);',
    ),
    '  });',
    '});',
    '',
  ].join('\n');
}
