import { NoopLogger } from '@hexok/logger';
import {
  collection,
  type Doc,
  family,
  framework,
  LatticeError,
  MemoryStore,
  many,
  type Repo,
  ref,
  tenancy,
} from '@latticecms/core';
import { catalog } from '@ts-pf/docs';
import { FetchHandler } from '@ts-pf/server-http';
import type { UseCase } from 'hexok';
import { z } from 'zod';

// A small app with each thing the admin renders: a ref, a many(), a
// maskable field with a title, a method, and a restrict child (contacts of
// a company), plus a collection no one may read.

const actorSchema = z.object({
  userId: z.string(),
  orgId: z.string(),
  role: z.enum(['member', 'manager']),
});

const AppUseCase = family({
  actor: actorSchema,
  actorId: (actor) => actor.userId,
  tenantOf: (actor) => actor.orgId,
});

type Actor = z.output<typeof actorSchema>;

export const member: Actor = { userId: 'ann', orgId: 'o1', role: 'member' };
export const manager: Actor = { userId: 'max', orgId: 'o1', role: 'manager' };

const Companies = collection('companies', {
  schema: z.object({
    name: z.string().min(1),
    domain: z.string().optional(),
    // A boolean has no order, so find cannot sort by it.
    active: z.boolean().default(true),
  }),
  tenant: 'orgId',
});

const Contacts = collection('contacts', {
  schema: z.object({
    name: z.string().min(1),
    email: z.string(),
    companyId: ref('companies'),
  }),
  tenant: 'orgId',
});

const Deals = collection('deals', {
  schema: z.object({
    title: z.string().min(1),
    companyId: ref('companies'),
    amount: z.number().min(0).meta({ title: 'Deal value' }),
    stage: z.enum(['lead', 'won', 'lost']).default('lead'),
  }),
  tenant: 'orgId',
  maskable: ['amount'],
  relations: {
    contacts: many('contacts', {
      through: 'deal_contacts',
      fields: z.object({ role: z.enum(['champion', 'other']) }),
    }),
  },
});

// No access function allows anything here, so every read is FORBIDDEN.
const Notes = collection('notes', {
  schema: z.object({ text: z.string() }),
  tenant: 'orgId',
});

class CloseDeal extends AppUseCase('deals.close', {
  collection: Deals,
  input: z.object({ id: z.string(), outcome: z.enum(['won', 'lost']) }),
  output: Deals.clientOutput,
  summary: 'Close a deal as won or lost, by its id.',
  effect: 'write',
}) {
  constructor(private readonly deals: Repo<typeof Deals>) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof AppUseCase>,
    input: { id: string; outcome: 'won' | 'lost' },
  ): Promise<Doc<typeof Deals>> {
    const scope = await ctx.access.scope(Deals, 'close');
    const deal = await this.deals.update(
      input.id,
      { stage: input.outcome },
      scope,
    );
    if (deal === null) {
      throw LatticeError.NOT_FOUND({ collection: Deals.slug, id: input.id });
    }
    return deal;
  }
}

const anyone = () => true;
const all = { read: anyone, create: anyone, update: anyone, delete: anyone };

const fw = framework({ family: AppUseCase })
  .collection(Companies, {
    // A company named "Hidden" is out of every caller's reach, so a ref to
    // it populates as `{ id }`.
    access: { ...all, read: () => ({ name: { ne: 'Hidden' } }) },
  })
  .collection(Contacts, { access: all })
  .collection(Deals, {
    access: { ...all, close: anyone },
    fields: { amount: { read: ({ actor }) => actor.role === 'manager' } },
    methods: { close: CloseDeal },
  })
  .collection(Notes, { access: {} });

/**
 * The app over a fresh MemoryStore, its catalog served at `/catalog.json`
 * as an app serves it, and a fetch that reaches both as `actor` does.
 */
export function adminApp() {
  const built = fw.build({
    store: new MemoryStore(),
    events: { publish: async (_event: object) => {} },
    methods: ({ repos }) => ({ deals: { close: new CloseDeal(repos.deals) } }),
  });
  const handler = new FetchHandler(built.app);
  const served = catalog(fw.contract, { prefix: '/rpc' });
  let actor = member;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname === '/catalog.json') {
      return Response.json(served);
    }
    const { matched, response } = await handler.handle(request, {
      prefix: '/rpc',
      context: () => ({ actor, logger: new NoopLogger() }),
    });
    return matched ? response : new Response('Not Found', { status: 404 });
  };
  return {
    fetch,
    repos: built.repos,
    scope: {
      companies: tenancy.scope(Companies, 'o1'),
      contacts: tenancy.scope(Contacts, 'o1'),
      deals: tenancy.scope(Deals, 'o1'),
      dealContacts: tenancy.scope(Deals.relations.contacts.through, 'o1'),
    },
    actAs: (next: Actor) => {
      actor = next;
    },
  };
}
