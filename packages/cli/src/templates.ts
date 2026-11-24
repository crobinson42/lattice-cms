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

/**
 * The collection's test: what the scaffold made, and nothing it did not.
 * The composition's contract has the slug and its six procedures, which
 * also proves every ref resolves within the app; and the schema parses a
 * document and refuses one without a name. It builds no app, so a ref, a
 * relation, a method or an override anywhere in the app never breaks it.
 * Without a composition export, only the schema test.
 */
export function testText(
  names: Names,
  app: TestImport | undefined,
  sort: (a: string, b: string) => number,
): string {
  const local = [...(app === undefined ? [] : [app])]
    .concat({ name: names.exportName, specifier: `./${names.file}.js` })
    .sort((a, b) => sort(a.specifier, b.specifier));
  const schema = `${names.exportName}.schema`;
  return [
    "import { describe, expect, it } from 'vitest';",
    ...local.map(
      ({ name, specifier }) => `import { ${name} } from '${specifier}';`,
    ),
    '',
    "// What the scaffold made. Test behavior through the app's own setup.",
    `describe(${quote(names.slug)}, () => {`,
    ...(app === undefined
      ? []
      : [
          "  it('is in the app, with its operations', () => {",
          "    const operations = ['find', 'count', 'get', 'create', 'update', 'delete'];",
          ...call(
            '    ',
            'const keys = Object.keys',
            [`${app.name}.contract.${names.slug}`],
            ';',
          ),
          '    expect(keys).toEqual(expect.arrayContaining(operations));',
          '  });',
          '',
        ]),
    "  it('parses a document, and refuses one without a name', () => {",
    ...call(
      '    ',
      `const parsed = ${schema}.parse`,
      [{ expanded: false, lines: (indent) => [`${indent}name: 'First',`] }],
      ';',
    ),
    "    expect(parsed).toMatchObject({ name: 'First' });",
    ...call('    ', `const refused = ${schema}.safeParse`, ['{}'], ';'),
    '    const paths = refused.error?.issues.map((issue) => issue.path);',
    "    expect(paths).toEqual([['name']]);",
    '  });',
    '});',
    '',
  ].join('\n');
}
