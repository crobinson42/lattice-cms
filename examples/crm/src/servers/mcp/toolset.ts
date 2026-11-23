import type { CallContext } from '@latticecms/core';
import { all, createToolkit } from '@ts-pf/mcp';
import type { Actor } from '../../app/use-cases/context.js';
import { contract } from '../rpc/contract.js';

const tk = createToolkit(contract).$context<CallContext<Actor>>();

// Lattice gives each generated operation its summary and effect. A method
// is the app's own, so it describes itself.
const close = tk.deals.close
  .describe(
    'Close a deal as won or lost, by its id. A deal closes once; closing it again is AlreadyClosed.',
  )
  .effect('write');

// No access rule allows these, so every call is FORBIDDEN: as tools they
// would only cost a model context and wrong turns. They stay on /rpc.
const alwaysDenied = [
  tk.memberships.create,
  tk.memberships.update,
  tk.memberships.delete,
];

/** The API's procedures as MCP tools, each named by its path. */
export const crmTools = tk.$toolset({
  tools: [
    all(tk, {
      exclude: [tk.deals.close, ...alwaysDenied],
    }),
    { deals_close: close },
  ],
});

// A new procedure fails this line until the toolset exposes it or this
// line excludes it.
tk.$coverage({ toolsets: [crmTools], exclude: alwaysDenied });
