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
import { PFError } from '@ts-pf/protocol';
import { FetchHandler } from '@ts-pf/server-http';
import { Errors, type UseCase } from 'hexok';
import { z } from 'zod';

// A small app with each thing the admin renders: a ref, a many(), a
// maskable field with a title, a document method with a declared error, a
// collection method, a field outside the form subset (an object), a
// restrict child (contacts of a company), a role that may not write, and a
// collection no one may read.

const actorSchema = z.object({
  userId: z.string(),
  orgId: z.string(),
  role: z.enum(['member', 'manager', 'viewer']),
});

const AppUseCase = family({
  actor: actorSchema,
  actorId: (actor) => actor.userId,
  tenantOf: (actor) => actor.orgId,
});

type Actor = z.output<typeof actorSchema>;

export const member: Actor = { userId: 'ann', orgId: 'o1', role: 'member' };
export const manager: Actor = { userId: 'max', orgId: 'o1', role: 'manager' };
export const viewer: Actor = { userId: 'vic', orgId: 'o1', role: 'viewer' };

const domainErrors = {
  AlreadyClosed: {
    message: 'The deal is already closed',
    data: z.object({ id: z.string() }),
  },
};

class DomainError extends Errors('fixture', domainErrors) {}

const Companies = collection('companies', {
  schema: z.object({
    name: z.string().min(1),
    domain: z.string().optional(),
    // A boolean has no order, so find cannot sort by it.
    active: z.boolean().default(true),
    // An object is outside the form's subset: it is edited as JSON.
    address: z.object({ city: z.string() }).optional(),
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
    closesAt: z.iso.datetime().optional(),
  }),
  tenant: 'orgId',
  maskable: ['amount'],
  relations: {
    contacts: many('contacts', {
      through: 'deal_contacts',
      fields: z.object({ role: z.enum(['champion', 'other']) }),
    }),
    partners: many('companies', { through: 'deal_partners' }),
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
    const deal = await this.deals.get(input.id, scope);
    if (deal === null) {
      throw LatticeError.NOT_FOUND({ collection: Deals.slug, id: input.id });
    }
    if (deal.stage !== 'lead') throw DomainError.AlreadyClosed({ id: deal.id });
    const closed = await this.deals.update(
      input.id,
      { stage: input.outcome },
      scope,
    );
    if (closed === null) {
      throw LatticeError.NOT_FOUND({ collection: Deals.slug, id: input.id });
    }
    return closed;
  }
}

class CountWon extends AppUseCase('deals.countWon', {
  collection: Deals,
  input: z.object({}),
  output: z.object({ count: z.number() }),
  summary: 'Count the won deals.',
  effect: 'read',
}) {
  constructor(private readonly deals: Repo<typeof Deals>) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof AppUseCase>,
  ): Promise<{ count: number }> {
    const scope = await ctx.access.scope(Deals, 'countWon');
    return { count: await this.deals.count({ stage: { eq: 'won' } }, scope) };
  }
}

const anyone = () => true;
const all = { read: anyone, create: anyone, update: anyone, delete: anyone };
const writer = ({ actor }: { readonly actor: Actor }) =>
  actor.role !== 'viewer';

const fw = framework({
  family: AppUseCase,
  errors: {
    declared: {
      AlreadyClosed: { ...domainErrors.AlreadyClosed, status: 409 },
    },
    map: (error) =>
      DomainError.is(error)
        ? new PFError({
            code: error.code,
            message: error.message,
            status: 409,
            data: error.data,
            cause: error,
          })
        : error,
  },
})
  .collection(Companies, {
    // A company named "Hidden" is out of every caller's reach, so a ref to
    // it populates as `{ id }`. A viewer may not write.
    access: {
      read: () => ({ name: { ne: 'Hidden' } }),
      create: writer,
      update: writer,
      delete: writer,
    },
  })
  .collection(Contacts, { access: all })
  .collection(Deals, {
    // A viewer may not update a deal, nor so set its links.
    access: { ...all, update: writer, close: anyone, countWon: anyone },
    fields: { amount: { read: ({ actor }) => actor.role === 'manager' } },
    methods: { close: CloseDeal, countWon: CountWon },
  })
  .collection(Notes, { access: {} });

/** A call the admin made: the procedure's path and the input it sent. */
export type Sent = { readonly path: string; readonly input: unknown };

/**
 * The app over a fresh MemoryStore, its catalog served at `/catalog.json`
 * as an app serves it, and a fetch that reaches both as `actor` does. It
 * records each procedure call's path and input.
 */
export function adminApp() {
  const built = fw.build({
    store: new MemoryStore(),
    events: { publish: async (_event: object) => {} },
    methods: ({ repos }) => ({
      deals: {
        close: new CloseDeal(repos.deals),
        countWon: new CountWon(repos.deals),
      },
    }),
  });
  const handler = new FetchHandler(built.app);
  const served = catalog(fw.contract, { prefix: '/rpc' });
  const sent: Sent[] = [];
  const canned = new Map<string, Response>();
  const held = new Map<string, Promise<void>>();
  let actor = member;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const { pathname } = new URL(request.url);
    if (pathname === '/catalog.json') return Response.json(served);
    const gate = held.get(pathname);
    if (gate !== undefined) {
      held.delete(pathname);
      await gate;
    }
    const answer = canned.get(pathname);
    if (answer !== undefined) {
      canned.delete(pathname);
      return answer;
    }
    if (request.method === 'POST') {
      // ts-pf sends `{ input }`.
      const body: unknown = await request.clone().json();
      const input =
        typeof body === 'object' && body !== null && 'input' in body
          ? body.input
          : body;
      sent.push({ path: pathname, input });
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
    /** The inputs sent to the procedure at `path`, such as `/rpc/deals/update`. */
    sentTo: (path: string) =>
      sent.filter((call) => call.path === path).map((call) => call.input),
    scope: {
      companies: tenancy.scope(Companies, 'o1'),
      contacts: tenancy.scope(Contacts, 'o1'),
      deals: tenancy.scope(Deals, 'o1'),
      dealContacts: tenancy.scope(Deals.relations.contacts.through, 'o1'),
    },
    actAs: (next: Actor) => {
      actor = next;
    },
    /**
     * Holds the next call to `path` until the returned function releases
     * it, so a test sees what renders while it is pending.
     */
    hold: (path: string): (() => void) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      held.set(path, promise);
      return () => resolve();
    },
    /** The next call to `path` gets `response`, not the app's answer. */
    answerNext: (path: string, response: Response) => {
      canned.set(path, response);
    },
  };
}
