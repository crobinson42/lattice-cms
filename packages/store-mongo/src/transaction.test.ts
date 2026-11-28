import { NoopLogger } from '@hexok/logger';
import {
  collection,
  type Doc,
  family,
  framework,
  type Repo,
  ref,
  type Transaction,
  tenancy,
  unscoped,
} from '@latticecms/core';
import type { UseCase } from 'hexok';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MongoStore } from './index.js';
import { databases } from './test/databases.js';

const dbs = databases();
afterAll(() => dbs.close());

const AppUseCase = family({
  actor: z.object({ userId: z.string(), organizationId: z.string() }),
  actorId: (actor) => actor.userId,
  tenantOf: (actor) => actor.organizationId,
});
type AppCtx = UseCase.Ctx<typeof AppUseCase>;

const tenant = 'organizationId';
const Companies = collection('companies', {
  schema: z.object({ name: z.string() }),
  tenant,
});
const Projects = collection('projects', {
  schema: z.object({ companyId: ref('companies', { onDelete: 'cascade' }) }),
  tenant,
});
const Logs = collection('logs', {
  schema: z.object({ message: z.string() }),
  tenant,
});
const all = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};

/**
 * Replaces companies.delete: the generated delete, which cascades in a
 * store transaction of its own, and a log row, as one unit. A name of
 * "keep" refuses after both are written.
 */
class DeleteCompany extends AppUseCase('companies.delete', {
  collection: Companies,
}) {
  constructor(
    private readonly deps: {
      transaction: Transaction<
        { logs: Repo<typeof Logs> },
        {
          companies: {
            delete: (
              ctx: AppCtx,
              input: { id: string },
            ) => Promise<Doc<typeof Companies>>;
          };
        }
      >;
    },
  ) {
    super();
  }

  async execute(
    ctx: AppCtx,
    input: { id: string },
  ): Promise<Doc<typeof Companies>> {
    return this.deps.transaction(async ({ logs }, generated) => {
      const company = await generated.companies.delete(ctx, input);
      await logs.insert(
        { message: `deleted ${company.name}` },
        tenancy.scope(Logs, company.organizationId),
      );
      if (company.name === 'keep') throw new Error('kept');
      return company;
    });
  }
}

let database: string;
let store: MongoStore;

beforeEach(async () => {
  database = dbs.fresh();
  store = new MongoStore({ url: dbs.url, database });
  await store.start();
});

afterEach(async () => {
  await store.stop();
  await dbs.drop(database);
});

function setup() {
  const published: string[] = [];
  const built = framework({ family: AppUseCase })
    .collection(Companies, {
      access: all,
      overrides: { delete: DeleteCompany },
    })
    .collection(Projects, { access: all })
    .collection(Logs, { access: all })
    .build({
      store,
      events: {
        async publish(event: object) {
          if ('token' in event && typeof event.token === 'string')
            published.push(event.token);
        },
      },
      overrides: ({ transaction }) => ({
        companies: { delete: new DeleteCompany({ transaction }) },
      }),
    });
  const ctx = () =>
    built.context({
      actor: { userId: 'u1', organizationId: 'A' },
      logger: new NoopLogger(),
    });
  return { ...built, published, ctx };
}

async function seed(repos: ReturnType<typeof setup>['repos'], name: string) {
  const company = await repos.companies.insert(
    { name },
    tenancy.scope(Companies, 'A'),
  );
  const project = await repos.projects.insert(
    { companyId: company.id },
    tenancy.scope(Projects, 'A'),
  );
  return { company, project };
}

describe('an override’s transaction on MongoStore', () => {
  it('commits the generated delete, its cascade and a repo write together, then publishes', async () => {
    const { useCases, repos, published, ctx } = setup();
    const { company, project } = await seed(repos, 'Acme');

    await useCases.companies.delete.execute(ctx(), { id: company.id });

    expect(await repos.companies.get(company.id, unscoped)).toBeNull();
    expect(await repos.projects.get(project.id, unscoped)).toBeNull();
    expect(
      (await repos.logs.find({}, unscoped)).docs.map(({ message }) => message),
    ).toEqual(['deleted Acme']);
    expect(published).toEqual(['projects.deleted', 'companies.deleted']);
  });

  it('rolls back the generated delete and its cascade with the work, and publishes nothing', async () => {
    const { useCases, repos, published, ctx } = setup();
    const { company, project } = await seed(repos, 'keep');

    await expect(
      useCases.companies.delete.execute(ctx(), { id: company.id }),
    ).rejects.toThrow('kept');

    expect(await repos.companies.get(company.id, unscoped)).not.toBeNull();
    expect(await repos.projects.get(project.id, unscoped)).not.toBeNull();
    expect((await repos.logs.find({}, unscoped)).docs).toEqual([]);
    expect(published).toEqual([]);
  });
});
