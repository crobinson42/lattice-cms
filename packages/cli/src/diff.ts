/** Lines of context around each change. */
const context = 3;

function linesOf(text: string): string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

type Op = { readonly kind: ' ' | '-' | '+'; readonly line: string };

/** The longest common subsequence of lines, as keep, remove and add steps. */
function opsOf(before: readonly string[], after: readonly string[]): Op[] {
  const width = after.length + 1;
  const table = new Uint32Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i * width + j] =
        before[i] === after[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(
              table[(i + 1) * width + j] ?? 0,
              table[i * width + j + 1] ?? 0,
            );
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    const removed = before[i];
    const added = after[j];
    if (removed !== undefined && added !== undefined && removed === added) {
      ops.push({ kind: ' ', line: removed });
      i++;
      j++;
    } else if (
      // A changed line shows its removal first, as unified diffs do.
      removed !== undefined &&
      (added === undefined ||
        (table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0))
    ) {
      ops.push({ kind: '-', line: removed });
      i++;
    } else if (added !== undefined) {
      ops.push({ kind: '+', line: added });
      j++;
    }
  }
  return ops;
}

/**
 * A unified diff of one file, `before` undefined for a new file. Each hunk
 * has three lines of context, and hunks that touch merge.
 */
export function diff(
  path: string,
  before: string | undefined,
  after: string,
): string {
  const ops = opsOf(linesOf(before ?? ''), linesOf(after));
  const out = [before === undefined ? '--- /dev/null' : `--- a/${path}`];
  out.push(`+++ b/${path}`);
  let index = 0;
  while (index < ops.length) {
    const first = ops.findIndex((op, at) => at >= index && op.kind !== ' ');
    if (first === -1) break;
    // Extend the hunk while the next change is within twice the context.
    let last = first;
    for (let at = first; at < ops.length; at++) {
      if (ops[at]?.kind !== ' ') last = at;
      else if (at - last > 2 * context) break;
    }
    const start = Math.max(first - context, index);
    const end = Math.min(last + context + 1, ops.length);
    const lead = ops.slice(0, start);
    const hunk = ops.slice(start, end);
    const oldStart = lead.filter((op) => op.kind !== '+').length;
    const newStart = lead.filter((op) => op.kind !== '-').length;
    const oldCount = hunk.filter((op) => op.kind !== '+').length;
    const newCount = hunk.filter((op) => op.kind !== '-').length;
    out.push(
      `@@ -${oldCount === 0 ? oldStart : oldStart + 1},${oldCount} +${newCount === 0 ? newStart : newStart + 1},${newCount} @@`,
    );
    for (const op of hunk) out.push(`${op.kind}${op.line}`);
    index = end;
  }
  return `${out.join('\n')}\n`;
}
