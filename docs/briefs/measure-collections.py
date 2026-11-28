"""Writes a Lattice app with N collections, with pieces switched off, and
measures tsc instantiations. The fixture behind the briefs in this folder.

Usage, with Lattice built (npm run build at the repo root), from anywhere:
  python3 docs/briefs/measure-collections.py <abs dir under examples/crm> <N> <variant>
For example: .../examples/crm/.measure 12 full, then 12 tkonly, then 12 allonly.
The directory resolves the crm's dependencies. Delete it afterwards.

Variants join with '+'. Removals: full, nocatalog, nomcp, noclient, norepos,
nobuild, nocontract. Use cases: uc0, uc1, ucall, uc0twice, uc0plain. Probes:
assign, plainfn, constfn, reserved, reservedplain, fixhexok, fixlight. MCP
splits: tkonly (createToolkit only), allonly (plus all(tk)), coverage, perslice.
"""
import sys, os, subprocess, re
d, n, variant = sys.argv[1], int(sys.argv[2]), sys.argv[3]
V = set(variant.split('+')) if variant != 'full' else set()
os.makedirs(d, exist_ok=True)
cols = []
for i in range(n):
    ref = "" if i == 0 else "\n    parentId: ref('c0').optional(),"
    cols.append(f"""export const C{i} = collection('c{i}', {{
  schema: z.object({{
    name: z.string().min(1),
    note: z.string().optional(),{ref}
  }}),
  tenant: 'organizationId',
}});""")
chain = "".join(f"\n  .collection(C{i}, {{ access: {{ read: anyone, create: anyone, update: anyone, delete: anyone }} }})" for i in range(n))
events = ",\n".join(f"  c{i}Created: C{i}.events.created,\n  c{i}Updated: C{i}.events.updated,\n  c{i}Deleted: C{i}.events.deleted" for i in range(n))
src = f"""import {{ collection, family, framework, MemoryStore, ref, tenancy }} from '@latticecms/core';
import {{ NoopLogger }} from '@hexok/logger';
import {{ createLocalClient }} from '@ts-pf/server';
import {{ createToolkit, all }} from '@ts-pf/mcp';
import {{ type EventInstance, EventCatalog, Port }} from 'hexok';
import {{ z }} from 'zod';

const actor = z.union([
  z.strictObject({{ userId: z.string(), organizationId: z.string() }}),
  z.strictObject({{ userId: z.string(), support: z.literal(true) }}),
]);
export const AppUseCase = family({{
  actor,
  actorId: (a) => a.userId,
  tenantOf: (a) => ('support' in a ? tenancy.bypass : a.organizationId),
}});
const anyone = () => true;

{chr(10).join(cols)}
"""
if 'nocatalog' not in V:
    src += f"""
export class DomainEvents extends EventCatalog('domain-events', {{
{events},
}}) {{}}
export abstract class Publisher extends Port('Publisher') {{
  abstract publish(event: EventInstance<typeof DomainEvents>): Promise<void>;
}}
declare const publisher: Publisher;
"""
else:
    src += "\nconst publisher = { async publish(_event: object) {} };\n"
src += f"""
export const app = framework({{ family: AppUseCase }}){chain};
"""
if 'nocontract' not in V:
    src += "export const contract = app.contract;\n"
if 'nobuild' not in V:
    src += "export const built = app.build({ store: new MemoryStore(), events: publisher });\n"
    if 'noclient' not in V:
        src += """const local = createLocalClient(built.app, { context: { actor: { userId: 'u', organizationId: 'o' }, logger: new NoopLogger() } });
export const one = local.c0.find({});
"""
    if 'norepos' not in V:
        src += "export const r = built.repos.c0;\nexport const u = built.useCases.c0.create;\n"
# A hand-written use case on collection k, declared and not registered:
# 'uc0' on c0, 'uc1' on c1, 'ucall' on every collection.
targets = [0] if 'uc0' in V else [1] if 'uc1' in V else list(range(n)) if 'ucall' in V else []
for k in targets:
    src += f"""export class Peek{k} extends AppUseCase('c{k}.peek', {{
  collection: C{k},
  input: z.object({{ id: z.string() }}),
  output: C{k}.clientOutput,
  summary: 'Peek.',
  effect: 'read',
}}) {{
  async execute(): Promise<never> {{ throw new Error('x'); }}
}}
"""
if 'uc0twice' in V:
    src += """export class Poke0 extends AppUseCase('c0.poke', {
  collection: C0,
  input: z.object({ id: z.string() }),
  output: C0.clientOutput,
  summary: 'Poke.',
  effect: 'read',
}) {
  async execute(): Promise<never> { throw new Error('x'); }
}
"""
if 'uc0plain' in V:
    src += """export class Plain0 extends AppUseCase('c0.plain', {
  collection: C0,
  input: z.object({}),
  output: z.object({}),
  summary: 'Plain.',
  effect: 'read',
}) {
  async execute(): Promise<never> { throw new Error('x'); }
}
"""
probe = "import type { AnyCollection } from '../../../packages/core/dist/collection.js';\nimport type { FamilySpec } from '../../../packages/core/dist/family.js';\ntype ReservedOk<S> = { [K in keyof S]: K extends 'token' | 'prototype' | 'name' | 'length' ? never : S[K] };\n"
if 'assign' in V:
    src += probe + "export const pa: AnyCollection = C0;\n"
if 'plainfn' in V:
    src += probe + "declare function fam<S extends FamilySpec>(s: S): S;\nexport const pb = fam({ collection: C0 });\n"
if 'constfn' in V:
    src += probe + "declare function fam<const S extends FamilySpec>(s: S): S;\nexport const pc = fam({ collection: C0 });\n"
if 'reserved' in V:
    src += probe + "declare function fam<const S extends FamilySpec>(s: ReservedOk<S> & FamilySpec): S;\nexport const pd = fam({ collection: C0 });\n"
if 'reservedplain' in V:
    src += probe + "declare function fam<S extends FamilySpec>(s: ReservedOk<S> & FamilySpec): S;\nexport const pe = fam({ collection: C0 });\n"
if 'fixhexok' in V:
    src += probe + "declare function fam<const S extends FamilySpec>(s: S & ReservedOk<S>): S;\nexport const pf = fam({ collection: C0 });\n"
if 'fixlight' in V:
    src += probe + "type Light = { readonly collection: { readonly slug: string; readonly tenant: string | undefined; readonly maskable: readonly string[]; readonly schema: z.core.$ZodType } };\ndeclare function fam<const S extends Light>(s: ReservedOk<S> & Light): S;\nexport const pg = fam({ collection: C0 });\n"
if 'nomcp' not in V and 'nocontract' not in V:
    if 'tkonly' in V:
        src += "export const tk = createToolkit(contract);\nexport const one0 = tk.c0.find;\n"
    elif 'perslice' in V:
        src += "const tk = createToolkit(contract);\nexport const tools = tk.$toolset({ tools: [" + ", ".join(f"all(tk.c{i})" for i in range(n)) + "] });\n"
    elif 'allonly' in V:
        src += "const tk = createToolkit(contract);\nexport const every = all(tk);\n"
    else:
        src += """const tk = createToolkit(contract);
export const tools = tk.$toolset({ tools: [all(tk)] });
"""
        if 'coverage' in V:
            src += "tk.$coverage({ toolsets: [tools] });\n"
open(os.path.join(d, 'app.ts'), 'w').write(src)
open(os.path.join(d, 'tsconfig.json'), 'w').write("""{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "composite": false, "declaration": false, "declarationMap": false, "sourceMap": false, "noUnusedLocals": false },
  "include": ["app.ts"]
}
""")
out = subprocess.run(['npx', 'tsc', '-p', os.path.join(d, 'tsconfig.json'), '--extendedDiagnostics'], capture_output=True, text=True, cwd=d)
errs = [l for l in out.stdout.splitlines() if 'error TS' in l]
m = re.search(r'Instantiations:\s+(\d+)', out.stdout)
print(n, variant, m.group(1) if m else 'NA', ('ERR ' + errs[0][:200]) if errs else '')
