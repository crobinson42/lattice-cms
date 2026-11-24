// Generated lines follow Biome's defaults (line width 80), so an app that
// runs Biome or Prettier finds nothing to change in a typical edit. Only the
// breaks the CLI's own lines need are here, one level deep: a name long
// enough to need a second level is left for the app's formatter.

const width = 80;

/** Whether a line fits Biome's default width. */
const fits = (line: string) => line.length <= width;

/** An object argument: its property lines, and whether it stays expanded. */
export type ObjectArg = {
  /** Its property lines at `indent`, each ending in a comma. */
  readonly lines: (indent: string) => readonly string[];
  /** Whether it is written over several lines, which Biome keeps. */
  readonly expanded: boolean;
};

type Arg = string | ObjectArg;

/** `{ a: 1, b: 2 }`: an object's property lines on one line. */
function inline(object: ObjectArg): string {
  const props = object.lines('').map((line) => line.replace(/,$/, ''));
  return `{ ${props.join(', ')} }`;
}

/**
 * A call, as Biome lays it out: on one line if it fits; else hugging a last
 * object argument, if the line up to its `{` fits; else one argument per
 * line. `tail` follows the closing parenthesis, such as `;`.
 */
export function call(
  indent: string,
  head: string,
  args: readonly Arg[],
  tail: string,
  unit = '  ',
): string[] {
  const last = args.at(-1);
  const first = args.slice(0, -1);
  if (args.every((arg) => typeof arg === 'string' || !arg.expanded)) {
    const one = `${indent}${head}(${args
      .map((arg) => (typeof arg === 'string' ? arg : inline(arg)))
      .join(', ')})${tail}`;
    if (fits(one)) return [one];
  }
  if (last !== undefined && typeof last !== 'string') {
    const open = `${indent}${head}(${[...first, '{'].join(', ')}`;
    if (first.every((arg) => typeof arg === 'string') && fits(open)) {
      return [open, ...last.lines(indent + unit), `${indent}})${tail}`];
    }
  }
  const inner = indent + unit;
  return [
    `${indent}${head}(`,
    ...args.flatMap((arg) =>
      typeof arg === 'string'
        ? [`${inner}${arg},`]
        : [`${inner}{`, ...arg.lines(inner + unit), `${inner}},`],
    ),
    `${indent})${tail}`,
  ];
}

/** `key: value,`, or the value on the next line when it does not fit. */
export function entry(
  indent: string,
  key: string,
  value: string,
  unit = '  ',
): string[] {
  const one = `${indent}${key}: ${value},`;
  return fits(one) ? [one] : [`${indent}${key}:`, `${indent}${unit}${value},`];
}

/** `key: { a, b },`, or the object's properties on their own lines. */
export function objectEntry(
  indent: string,
  key: string,
  props: readonly string[],
  unit = '  ',
): string[] {
  const one = `${indent}${key}: { ${props.join(', ')} },`;
  return fits(one)
    ? [one]
    : [
        `${indent}${key}: {`,
        ...props.map((prop) => `${indent}${unit}${prop},`),
        `${indent}},`,
      ];
}
