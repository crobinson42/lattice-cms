import type * as TS from 'typescript';
import { Exit } from './exit.js';
import { call, entry } from './layout.js';
import type { Names } from './names.js';
import type { TypeScript } from './typescript.js';

/** Text to insert at an offset of a file. */
export type Insert = { readonly offset: number; readonly text: string };

/**
 * Lines a command adds to a file, where they go in words, and the inserts
 * that put them there. A refused file has no inserts.
 */
export type Addition = {
  readonly where: string;
  readonly lines: string;
  readonly inserts: readonly Insert[];
};

/** The additions to one file, or why its shape gives them no place. */
export type FileEdit = {
  readonly path: string;
  readonly before: string;
  readonly additions: readonly Addition[];
  readonly refused: string | undefined;
};

/**
 * `text` with each insert applied. Inserts never overlap; two at one offset
 * land in the order given.
 */
export function applyInserts(text: string, inserts: readonly Insert[]): string {
  return inserts
    .map((insert, order) => ({ insert, order }))
    .sort((a, b) => b.insert.offset - a.insert.offset || b.order - a.order)
    .reduce(
      (out, { insert }) =>
        `${out.slice(0, insert.offset)}${insert.text}${out.slice(insert.offset)}`,
      text,
    );
}

export function parse(ts: TypeScript, path: string, text: string) {
  return ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    /\.[cm]?tsx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** How a file writes line breaks and one level of indent. */
type Style = { readonly newline: string; readonly unit: string };

/**
 * The file's line break, and its indent unit: a tab, or the fewest leading
 * spaces on a code line. JSDoc's ` * ` lines do not count.
 */
function styleOf(text: string): Style {
  const lines = text.split(/\r?\n/);
  const spaces = lines.flatMap((line) => {
    const lead = /^( +)[^ *]/.exec(line)?.[1];
    return lead === undefined ? [] : [lead.length];
  });
  const unit = lines.some((line) => /^\t+\S/.test(line))
    ? '\t'
    : ' '.repeat(spaces.length === 0 ? 2 : Math.min(...spaces));
  return { newline: text.includes('\r\n') ? '\r\n' : '\n', unit };
}

/** The additions with their inserted text in the file's line breaks. */
function inStyle(additions: readonly Addition[], { newline }: Style) {
  return additions.map((addition) => ({
    ...addition,
    inserts: addition.inserts.map((insert) => ({
      ...insert,
      text: insert.text.replaceAll('\n', newline),
    })),
  }));
}

/** The whitespace that starts the line holding `position`. */
function indentAt(source: TS.SourceFile, position: number): string {
  const { line } = source.getLineAndCharacterOfPosition(position);
  const start = source.getPositionOfLineAndCharacter(line, 0);
  return /^[ \t]*/.exec(source.text.slice(start))?.[0] ?? '';
}

const lineOf = (source: TS.SourceFile, position: number) =>
  source.getLineAndCharacterOfPosition(position).line;

/** `position`, moved past the comments that end its line, so they stay where they are. */
function pastComments(ts: TypeScript, text: string, position: number): number {
  return ts.getTrailingCommentRanges(text, position)?.at(-1)?.end ?? position;
}

/** The end of the comma token at `position`, skipping trivia, if there is one. */
function commaAfter(
  ts: TypeScript,
  text: string,
  position: number,
): number | undefined {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    text,
  );
  scanner.setText(text, position);
  return scanner.scan() === ts.SyntaxKind.CommaToken
    ? scanner.getTokenEnd()
    : undefined;
}

/** Every call of the identifier `name` in the file. */
function callsOf(
  ts: TypeScript,
  source: TS.SourceFile,
  name: string,
): TS.CallExpression[] {
  const calls: TS.CallExpression[] = [];
  const visit = (node: TS.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

/** The local name the file imports `name` from `module` as. */
export function importedAs(
  ts: TypeScript,
  source: TS.SourceFile,
  name: string,
  module: string,
): string | undefined {
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== module
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === name) {
        return element.name.text;
      }
    }
  }
  return undefined;
}

/** The names a binding declares: `a`, `{ a, b: c }` and `[a, ...b]`. */
function bindingNames(ts: TypeScript, name: TS.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? bindingNames(ts, element.name) : [],
  );
}

/** The names the file imports, and the names it declares at the top level. */
function topLevelNames(ts: TypeScript, source: TS.SourceFile) {
  const imported = new Set<string>();
  const declared = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      if (clause?.name !== undefined) imported.add(clause.name.text);
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        imported.add(bindings.name.text);
      }
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          imported.add(element.name.text);
        }
      }
    } else if (ts.isImportEqualsDeclaration(statement)) {
      imported.add(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(ts, declaration.name)) {
          declared.add(name);
        }
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name !== undefined &&
      ts.isIdentifier(statement.name)
    ) {
      declared.add(statement.name.text);
    }
  }
  return { imported, declared };
}

/** A relative specifier's distance up, then its path, compared as numbers where digits run. */
export function compareSpecifiers(a: string, b: string): number {
  const depth = (s: string) => s.match(/\.\.\//g)?.length ?? 0;
  if (depth(a) !== depth(b)) return depth(b) - depth(a);
  const rest = (s: string) => s.replace(/^(\.\.?\/)+/, '').split(/(\d+)/);
  const left = rest(a);
  const right = rest(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i] ?? '';
    const y = right[i] ?? '';
    if (x === y) continue;
    if (i % 2 === 1) return Number(x) - Number(y);
    return x < y ? -1 : 1;
  }
  return left.length - right.length;
}

/**
 * An import of `name` from the relative `specifier`, among the file's
 * imports in Biome's order: farther paths first, then by path. A file that
 * already imports or declares `name` is refused.
 */
function importAddition(
  ts: TypeScript,
  source: TS.SourceFile,
  file: string,
  name: string,
  specifier: string,
): Addition {
  const { imported, declared } = topLevelNames(ts, source);
  if (imported.has(name)) throw new Exit(`${file} already imports ${name}`, 1);
  if (declared.has(name)) throw new Exit(`${file} already declares ${name}`, 1);
  const line = `import { ${name} } from '${specifier}';`;
  const where = 'with the imports';
  const imports = source.statements.filter(ts.isImportDeclaration);
  const next = imports.findIndex(
    (statement) =>
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.startsWith('.') &&
      compareSpecifiers(statement.moduleSpecifier.text, specifier) > 0,
  );
  const previous = imports[next === -1 ? imports.length - 1 : next - 1];
  const first = imports[0];
  const insert: Insert | undefined =
    previous !== undefined
      ? {
          offset: pastComments(ts, source.text, previous.getEnd()),
          text: `\n${line}`,
        }
      : first !== undefined
        ? { offset: first.getStart(source), text: `${line}\n` }
        : // A file with no imports has no framework() or EventCatalog()
          // from a package, so it is refused and this addition is printed.
          undefined;
  return { where, lines: line, inserts: insert === undefined ? [] : [insert] };
}

/** Whether the file declares `anyone` at the top level. */
function declaresAnyone(ts: TypeScript, source: TS.SourceFile): boolean {
  return topLevelNames(ts, source).declared.has('anyone');
}

/**
 * The composition's edit: an import, and a `.collection()` call at the end
 * of the one `framework()` chain, open to any signed-in caller. Its shape
 * must be `export const app = framework(...).collection(...)...`; `app` is
 * the export a test reads the contract from.
 */
export function compositionEdit(
  ts: TypeScript,
  path: string,
  file: string,
  before: string,
  names: Names,
  specifier: string,
): FileEdit & { readonly app: string | undefined } {
  const source = parse(ts, path, before);
  const style = styleOf(before);
  const { unit } = style;
  const imported = importAddition(
    ts,
    source,
    file,
    names.exportName,
    specifier,
  );
  const open = declaresAnyone(ts, source);
  const callLines = (indent: string) =>
    call(
      indent,
      '.collection',
      [
        names.exportName,
        {
          expanded: true,
          lines: (inner) =>
            open
              ? [
                  `${inner}access: { read: anyone, create: anyone, update: anyone, delete: anyone },`,
                ]
              : [
                  `${inner}access: {`,
                  ...['read', 'create', 'update', 'delete'].map(
                    (action) => `${inner}${unit}${action}: () => true,`,
                  ),
                  `${inner}},`,
                ],
        },
      ],
      '',
      unit,
    ).join('\n');
  const where = 'at the end of the framework() chain';
  const refuse = (why: string) => ({
    path,
    before,
    additions: [
      { ...imported, inserts: [] },
      { where, lines: callLines(unit), inserts: [] },
    ],
    refused: why,
    app: undefined,
  });

  const local = importedAs(ts, source, 'framework', '@latticecms/core');
  const calls = local === undefined ? [] : callsOf(ts, source, local);
  const [call0] = calls;
  if (call0 === undefined || calls.length > 1) {
    return refuse(
      calls.length === 0
        ? `${file} has no framework() chain`
        : `${file} has ${calls.length} framework() chains`,
    );
  }
  let top: TS.Expression = call0;
  let lastLink: TS.MemberName | undefined;
  for (
    let link = top.parent;
    ts.isPropertyAccessExpression(link) &&
    link.expression === top &&
    ts.isCallExpression(link.parent) &&
    link.parent.expression === link;
    link = top.parent
  ) {
    if (link.name.text !== 'collection') {
      return refuse(
        `the framework() chain in ${file} calls .${link.name.text}(), so its end is not where collections go`,
      );
    }
    const [registered] = link.parent.arguments;
    if (
      registered !== undefined &&
      ts.isIdentifier(registered) &&
      registered.text === names.exportName
    ) {
      throw new Exit(`${file} already registers ${names.exportName}`, 1);
    }
    lastLink = link.name;
    top = link.parent;
  }
  const notExported = refuse(
    `the framework() chain in ${file} is not an exported const`,
  );
  const declaration = top.parent;
  if (
    !ts.isVariableDeclaration(declaration) ||
    !ts.isIdentifier(declaration.name)
  ) {
    return notExported;
  }
  const statement = declaration.parent.parent;
  if (
    !ts.isVariableStatement(statement) ||
    statement.parent !== source ||
    (statement.declarationList.flags & ts.NodeFlags.Const) === 0 ||
    !statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  ) {
    return notExported;
  }
  // A link on a line of its own sets the indent; a chain on the statement's
  // line gets the statement's indent and one unit.
  const start = statement.getStart(source);
  const indent =
    lastLink !== undefined &&
    lineOf(source, lastLink.getStart(source)) !== lineOf(source, start)
      ? indentAt(source, lastLink.getStart(source))
      : `${indentAt(source, start)}${unit}`;
  const lines = callLines(indent);
  return {
    path,
    before,
    additions: inStyle(
      [
        imported,
        {
          where,
          lines,
          inserts: [
            {
              offset: pastComments(ts, before, top.getEnd()),
              text: `\n${lines}`,
            },
          ],
        },
      ],
      style,
    ),
    refused: undefined,
    app: declaration.name.text,
  };
}

const events = ['created', 'updated', 'deleted'];

/** The name of a property, when it is an identifier or a string. */
function nameOf(ts: TypeScript, property: TS.ObjectLiteralElementLike) {
  const { name } = property;
  return name !== undefined &&
    (ts.isIdentifier(name) || ts.isStringLiteral(name))
    ? name.text
    : undefined;
}

/** Whether a property is `X.events.created`, `.updated` or `.deleted` of a collection. */
function isCollectionEvent(
  ts: TypeScript,
  property: TS.ObjectLiteralElementLike,
): boolean {
  if (!ts.isPropertyAssignment(property)) return false;
  const value = property.initializer;
  return (
    ts.isPropertyAccessExpression(value) &&
    events.includes(value.name.text) &&
    ts.isPropertyAccessExpression(value.expression) &&
    value.expression.name.text === 'events' &&
    ts.isIdentifier(value.expression.expression)
  );
}

/**
 * The events catalog's edit: an import, and the collection's three events
 * after the last collection's, in the one `EventCatalog()` literal.
 */
export function eventsEdit(
  ts: TypeScript,
  path: string,
  file: string,
  before: string,
  names: Names,
  specifier: string,
): FileEdit {
  const source = parse(ts, path, before);
  const style = styleOf(before);
  const { unit } = style;
  const imported = importAddition(
    ts,
    source,
    file,
    names.exportName,
    specifier,
  );
  const keys = events.map(
    (event) => `${names.camel}${event[0]?.toUpperCase()}${event.slice(1)}`,
  );
  const entries = (indent: string) =>
    events
      .flatMap((event, index) =>
        entry(
          indent,
          keys[index] ?? event,
          `${names.exportName}.events.${event}`,
          unit,
        ),
      )
      .join('\n');
  const where = "after the last collection's events";
  const local = importedAs(ts, source, 'EventCatalog', 'hexok');
  const calls = local === undefined ? [] : callsOf(ts, source, local);
  const literal = calls[0]?.arguments[1];
  if (
    calls.length !== 1 ||
    literal === undefined ||
    !ts.isObjectLiteralExpression(literal)
  ) {
    return {
      path,
      before,
      additions: [
        { ...imported, inserts: [] },
        { where, lines: entries(unit), inserts: [] },
      ],
      refused:
        calls.length === 0
          ? `${file} has no EventCatalog()`
          : calls.length > 1
            ? `${file} has ${calls.length} EventCatalog() calls`
            : `the EventCatalog() in ${file} has no object literal of events`,
    };
  }
  const { properties } = literal;
  for (const property of properties) {
    const name = nameOf(ts, property);
    if (name !== undefined && keys.includes(name)) {
      throw new Exit(`${file} already lists ${name}`, 1);
    }
  }
  const open = literal.getStart(source);
  const after =
    properties.findLast((property) => isCollectionEvent(ts, property)) ??
    properties.at(-1);
  // Entries on a line of their own set the indent; a literal on one line
  // gets its line's indent and one unit.
  const indent =
    after !== undefined &&
    lineOf(source, after.getStart(source)) !== lineOf(source, open)
      ? indentAt(source, after.getStart(source))
      : `${indentAt(source, open)}${unit}`;
  const lines = entries(indent);
  let inserts: Insert[];
  if (after === undefined) {
    inserts = [
      {
        offset: pastComments(ts, before, open + 1),
        text: `\n${lines}\n${indentAt(source, open)}`,
      },
    ];
  } else {
    const followed =
      properties.indexOf(after) < properties.length - 1 ||
      properties.hasTrailingComma;
    const comma = followed ? commaAfter(ts, before, after.getEnd()) : undefined;
    inserts =
      comma !== undefined
        ? [{ offset: pastComments(ts, before, comma), text: `\n${lines}` }]
        : [
            // The comma goes before any comment that ends the line, and
            // the entries after it.
            { offset: after.getEnd(), text: ',' },
            {
              offset: pastComments(ts, before, after.getEnd()),
              text: `\n${lines.slice(0, -1)}`,
            },
          ];
  }
  return {
    path,
    before,
    additions: inStyle([imported, { where, lines, inserts }], style),
    refused: undefined,
  };
}
