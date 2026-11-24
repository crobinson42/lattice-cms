import { readFileSync } from 'node:fs';

/** What the runner does with a fenced block. */
export type Step =
  | { readonly kind: 'run'; readonly line: number; readonly script: string }
  | { readonly kind: 'start'; readonly line: number; readonly script: string }
  | {
      readonly kind: 'write';
      readonly line: number;
      readonly path: string;
      readonly text: string;
    };

/** The languages whose blocks must be run, written or marked. */
const checked = new Set(['bash', 'sh', 'ts', 'tsx', 'js', 'json', 'html']);

/** The info word that marks a block as illustration only. */
export const illustration = 'illustration';

/**
 * The steps of the README section `heading`, in order. A `bash` block runs;
 * `bash start` runs in the background; a block with a path after its
 * language (```ts src/app.ts) is written whole. Any other bash, ts, tsx,
 * js, json or html block fails, unless its info says `illustration`. Other
 * languages, such as `text`, are shown and not run.
 */
export function stepsOf(readme: string, heading: string): Step[] {
  const lines = readFileSync(readme, 'utf8').split('\n');
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) throw new Error(`${readme} has no "## ${heading}"`);
  const end = lines.findIndex(
    (line, at) => at > start && line.startsWith('## '),
  );
  const steps: Step[] = [];
  for (let at = start + 1; at < (end === -1 ? lines.length : end); at++) {
    const open = /^```(\S+)(?:\s+(\S+))?\s*$/.exec(lines[at] ?? '');
    if (open === null) continue;
    const close = lines.indexOf('```', at + 1);
    if (close === -1) throw new Error(`${readme}:${at + 1}: unclosed block`);
    const [, lang = '', info] = open;
    const body = lines.slice(at + 1, close).join('\n');
    const line = at + 1;
    at = close;
    if (!checked.has(lang) || info === illustration) continue;
    if ((lang === 'bash' || lang === 'sh') && info === undefined) {
      steps.push({ kind: 'run', line, script: body });
    } else if ((lang === 'bash' || lang === 'sh') && info === 'start') {
      steps.push({ kind: 'start', line, script: body });
    } else if (info !== undefined && /[./]/.test(info)) {
      steps.push({ kind: 'write', line, path: info, text: `${body}\n` });
    } else {
      throw new Error(
        `${readme}:${line}: a ${lang} block the walkthrough cannot classify: give it a path, \`start\`, or \`${illustration}\``,
      );
    }
  }
  return steps;
}
