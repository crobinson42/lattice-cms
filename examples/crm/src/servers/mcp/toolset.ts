import type { CallContext } from '@latticecms/core';
import { all, createToolkit } from '@ts-pf/mcp';
import type { Actor } from '../../app/use-cases/context.js';
import { contract } from '../rpc/contract.js';

const tk = createToolkit(contract).$context<CallContext<Actor>>();

// No access rule allows these, so every call is FORBIDDEN: as tools they
// would only cost a model context and wrong turns. They stay on /rpc.
const alwaysDenied = [
  tk.memberships.create,
  tk.memberships.update,
  tk.memberships.delete,
];

/**
 * The API's procedures as MCP tools, each named by its path. Every one
 * carries its summary and effect from the contract: Lattice writes them for
 * generated operations, and a method declares them on its use case.
 */
export const crmTools = tk.$toolset({
  tools: [all(tk, { exclude: alwaysDenied })],
});

// A new procedure fails this line until the toolset exposes it or this
// line excludes it.
tk.$coverage({ toolsets: [crmTools], exclude: alwaysDenied });
