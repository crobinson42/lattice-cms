import { NoopLogger } from '@hexok/logger';
import {
  collection,
  family,
  framework,
  LatticeError,
  ref,
  tenancy,
  unscoped,
} from '@latticecms/core';
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

const tenant = 'organizationId';
const Companies = collection('companies', {
  schema: z.object({ name: z.string() }),
  tenant,
});
const Projects = collection('projects', {
  schema: z.object({ companyId: ref('companies', { onDelete: 'cascade' }) }),
  tenant,
});
const Tasks = collection('tasks', {
  schema: z.object({ projectId: ref('projects', { onDelete: 'cascade' }) }),
  tenant,
});
const Invoices = collection('invoices', {
  schema: z.object({ taskId: ref('tasks') }),
  tenant,
});
const Notes = collection('notes', {
  schema: z.object({
    projectId: ref('projects', { onDelete: 'nullify' }).nullable(),
  }),
  tenant,
});
const all = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};

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
    .collection(Companies, { access: all })
    .collection(Projects, { access: all })
    .collection(Tasks, { access: all })
    .collection(Invoices, { access: all })
    .collection(Notes, { access: all })
    .build({
      store,
      events: {
        async publish(event: object) {
          if ('token' in event && typeof event.token === 'string')
            published.push(event.token);
        },
      },
    });
  const ctx = () =>
    built.context({
      actor: { userId: 'u1', organizationId: 'A' },
      logger: new NoopLogger(),
    });
  return { ...built, published, ctx };
}

async function seed(repos: ReturnType<typeof setup>['repos']) {
  const company = await repos.companies.insert(
    { name: 'Acme' },
    tenancy.scope(Companies, 'A'),
  );
  const project = await repos.projects.insert(
    { companyId: company.id },
    tenancy.scope(Projects, 'A'),
  );
  const task = await repos.tasks.insert(
    { projectId: project.id },
    tenancy.scope(Tasks, 'A'),
  );
  return { company, project, task };
}

describe('onDelete on MongoStore', () => {
  it('cascades through build() in one transaction, then publishes', async () => {
    const { useCases, repos, published, ctx } = setup();
    const { company, project, task } = await seed(repos);

    await useCases.companies.delete.execute(ctx(), { id: company.id });

    expect(await repos.companies.get(company.id, unscoped)).toBeNull();
    expect(await repos.projects.get(project.id, unscoped)).toBeNull();
    expect(await repos.tasks.get(task.id, unscoped)).toBeNull();
    expect(published).toEqual([
      'tasks.deleted',
      'projects.deleted',
      'companies.deleted',
    ]);
  });

  it('rolls back every write when one fails part way, and publishes nothing', async () => {
    const { useCases, repos, published, ctx } = setup();
    const { company, project, task } = await seed(repos);
    const second = await repos.projects.insert(
      { companyId: company.id },
      tenancy.scope(Projects, 'A'),
    );
    // Nullifying both notes sets two projectIds to null, which a unique
    // index refuses: the second write fails after the first succeeded.
    await store.ensure('notes', [{ fields: { projectId: 1 }, unique: true }]);
    const notes = tenancy.scope(Notes, 'A');
    const first = await repos.notes.insert({ projectId: project.id }, notes);
    const other = await repos.notes.insert({ projectId: second.id }, notes);

    const error = await useCases.companies.delete
      .execute(ctx(), { id: company.id })
      .catch((caught: unknown) => caught);

    expect(LatticeError.is(error) && error.code).toBe('CONFLICT');
    expect(await repos.companies.get(company.id, unscoped)).not.toBeNull();
    expect(await repos.projects.get(project.id, unscoped)).not.toBeNull();
    expect(await repos.tasks.get(task.id, unscoped)).not.toBeNull();
    // Neither note keeps a nullified projectId, whichever was written first.
    expect(await repos.notes.getMany([first.id, other.id], unscoped)).toEqual([
      first,
      other,
    ]);
    expect(published).toEqual([]);
  });

  it('refuses a restrict found deep in the cascade before writing', async () => {
    const { useCases, repos, published, ctx } = setup();
    const { company, task } = await seed(repos);
    await repos.invoices.insert(
      { taskId: task.id },
      tenancy.scope(Invoices, 'A'),
    );

    const error = await useCases.companies.delete
      .execute(ctx(), { id: company.id })
      .catch((caught: unknown) => caught);

    expect(LatticeError.is(error) && error.code).toBe('REFERENCED');
    expect(await repos.tasks.get(task.id, unscoped)).not.toBeNull();
    expect(published).toEqual([]);
  });
});
