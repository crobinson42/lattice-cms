// npm run type-cost -w @latticecms/core: guards how a generated procedure's
// type cost grows with the number of collections in an app.
//
// It writes a small app of N plain tenanted collections (a name, an optional
// note, and an optional ref to c0), composes them with framework().collection()
// and reads `.contract`, then calls every procedure through
// ContractClient<typeof contract>, as an app's typed client does. tsc counts
// the type instantiations three times per size: the composition alone (base),
// plus a get and a find on every collection (reads), and plus a count,
// create, update and delete on every collection (writes). The cost of one
// procedure is (variant - base) / procedures.
//
// It fails when, from N = 6 to N = 24:
// - a read's cost grows by more than the ratio measured on 2026-11-25
//   (5,639 / 3,565 = 1.58) plus 10%. A populated read costs about 90 more
//   instantiations for every collection already in the app, through the
//   entries map its types carry (see architecture.md, Known limits);
// - a write's cost grows by more than 10%: writes do not depend on N.
//
// It needs core built (npm run build, or type-check, which builds first). It
// writes the app to .type-cost/ beside this script's package, and removes it.
// Six tsc runs: about 5 s.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const sizes = [6, 24];
const readBound = (5639 / 3565) * 1.1;
const writeBound = 1.1;

const core = new URL('../', import.meta.url);
const dir = new URL('.type-cost/', core);
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

if (!existsSync(new URL('dist/index.d.ts', core))) {
  console.error('type-cost: build core first (npm run build)');
  process.exit(1);
}

/** The app's source with N collections, calling `calls(i)` on each. */
function app(n, calls) {
  const collections = Array.from({ length: n }, (_, i) => {
    const ref = i === 0 ? '' : "\n    parentId: ref('c0').optional(),";
    return `export const C${i} = collection('c${i}', {
  schema: z.object({
    name: z.string().min(1),
    note: z.string().optional(),${ref}
  }),
  tenant: 'organizationId',
});`;
  });
  const chain = Array.from(
    { length: n },
    (_, i) =>
      `\n  .collection(C${i}, { access: { read: anyone, create: anyone, update: anyone, delete: anyone } })`,
  ).join('');
  const lines = Array.from({ length: n }, (_, i) => calls(i))
    .filter((list) => list.length > 0)
    .map((list, i) => `export const r${i} = [${list.join(', ')}];`);
  return `import { collection, family, framework, ref, tenancy } from '@latticecms/core';
import type { ContractClient } from '@ts-pf/contract';
import { z } from 'zod';

const actor = z.union([
  z.strictObject({ userId: z.string(), organizationId: z.string() }),
  z.strictObject({ userId: z.string(), support: z.literal(true) }),
]);
export const AppUseCase = family({
  actor,
  actorId: (a) => a.userId,
  tenantOf: (a) => ('support' in a ? tenancy.bypass : a.organizationId),
});
const anyone = () => true;

${collections.join('\n')}

export const app = framework({ family: AppUseCase })${chain};
export const contract = app.contract;
declare const client: ContractClient<typeof contract>;
${lines.join('\n')}
`;
}

const variants = {
  base: () => [],
  reads: (i) => [`client.c${i}.get({ id: 'x' })`, `client.c${i}.find({})`],
  writes: (i) => [
    `client.c${i}.count({})`,
    `client.c${i}.create({ name: 'n' })`,
    `client.c${i}.update({ id: 'x' })`,
    `client.c${i}.delete({ id: 'x' })`,
  ],
};

/** tsc's instantiation count for the app with N collections and `calls`. */
function instantiations(n, calls) {
  writeFileSync(new URL('app.ts', dir), app(n, calls));
  let out;
  try {
    out = execFileSync(
      process.execPath,
      [
        tsc,
        '-p',
        new URL('tsconfig.json', dir).pathname,
        '--extendedDiagnostics',
      ],
      { encoding: 'utf8' },
    );
  } catch (error) {
    throw new Error(`type-cost: the app does not type-check\n${error.stdout}`);
  }
  const found = /Instantiations:\s+(\d+)/.exec(out);
  if (found === null) throw new Error('type-cost: tsc printed no count');
  return Number(found[1]);
}

mkdirSync(dir, { recursive: true });
writeFileSync(
  new URL('tsconfig.json', dir),
  JSON.stringify({
    extends: '../../../tsconfig.base.json',
    compilerOptions: {
      noEmit: true,
      composite: false,
      declaration: false,
      declarationMap: false,
      sourceMap: false,
      noUnusedLocals: false,
    },
    include: ['app.ts'],
  }),
);
const per = {};
try {
  for (const n of sizes) {
    const base = instantiations(n, variants.base);
    per[n] = {
      read: (instantiations(n, variants.reads) - base) / (2 * n),
      write: (instantiations(n, variants.writes) - base) / (4 * n),
    };
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const [small, large] = sizes;
const readRatio = per[large].read / per[small].read;
const writeRatio = per[large].write / per[small].write;
const row = (what, ratio, bound) =>
  `${what.padEnd(6)} ${String(Math.round(per[small][what])).padStart(6)} ${String(
    Math.round(per[large][what]),
  ).padStart(
    7,
  )} ${ratio.toFixed(2).padStart(7)} ${bound.toFixed(2).padStart(7)}`;
console.log(`per procedure  N=${small}  N=${large}   ratio   bound`);
console.log(row('read', readRatio, readBound));
console.log(row('write', writeRatio, writeBound));
if (readRatio > readBound || writeRatio > writeBound) {
  console.error(
    'type-cost: a procedure costs more per collection than it did; see the top of packages/core/scripts/type-cost.mjs',
  );
  process.exit(1);
}
