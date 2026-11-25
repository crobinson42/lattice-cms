import { NoopLogger } from '@hexok/logger';
import { asResult } from '@ts-pf/client';
import { createLocalClient } from '@ts-pf/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppUseCase, actor } from './fixtures/context.js';
import { collection, framework, MemoryStore, many, ref } from './index.js';

// An object-level refine holds on create and on the merged document of an
// update, and a refined collection still builds its outputs: populated
// reads and masked fields extend them.

const Companies = collection('companies', {
  schema: z.object({ name: z.string() }),
});
const Tags = collection('tags', { schema: z.object({ name: z.string() }) });
const Notes = collection('notes', {
  schema: z
    .object({
      text: z.string(),
      companyId: ref('companies').optional(),
      contact: z.string().optional(),
      secret: z.number().optional(),
    })
    .refine(
      (note) => note.companyId !== undefined || note.contact !== undefined,
      { path: ['companyId'], message: 'Give a company or a contact' },
    ),
  relations: { tags: many('tags', { through: 'note_tags' }) },
  maskable: ['secret'],
});

const open = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};

function setup() {
  const { app } = framework({ family: AppUseCase })
    .collection(Companies, { access: open })
    .collection(Tags, { access: open })
    .collection(Notes, {
      access: open,
      fields: { secret: { read: () => true } },
    })
    .build({
      store: new MemoryStore(),
      events: { async publish(_event: object) {} },
    });
  return createLocalClient(app, {
    context: { actor, logger: new NoopLogger() },
  });
}

const refused = [
  { path: ['companyId'], message: 'Give a company or a contact' },
];

describe('a refined collection schema', () => {
  it('builds its contract and populates refs and relations on get and find', async () => {
    const local = setup();
    const acme = await local.companies.create({ name: 'Acme' });
    const tag = await local.tags.create({ name: 'hot' });
    const note = await local.notes.create({
      text: 'Hi',
      companyId: acme.id,
      secret: 1,
    });
    await local.notes.tags.set({ id: note.id, links: [{ tagsId: tag.id }] });

    const got = await local.notes.get({
      id: note.id,
      populate: ['companyId', 'tags'],
    });
    const { docs } = await local.notes.find({ populate: ['companyId'] });

    expect(got.companyId).toEqual(acme);
    expect(got.tags).toEqual([{ doc: tag }]);
    expect(got.secret).toBe(1);
    expect(docs.map((doc) => doc.companyId)).toEqual([acme]);
  });

  it('refuses a create that breaks the refine', async () => {
    const local = setup();

    const result = await asResult(local.notes.create({ text: 'Floating' }));

    if (result.ok || result.error.code !== 'VALIDATION') {
      throw new Error('expected VALIDATION');
    }
    expect(result.error.data.issues).toEqual(refused);
  });

  it('refuses an update whose merged document breaks it', async () => {
    const local = setup();
    const note = await local.notes.create({ text: 'Hi', contact: 'Ada' });

    // The patch alone is fine; with the stored document, nothing is left.
    const result = await asResult(
      local.notes.update({ id: note.id, contact: null }),
    );
    const kept = await local.notes.update({
      id: note.id,
      companyId: 'c1',
      contact: null,
    });

    if (result.ok || result.error.code !== 'VALIDATION') {
      throw new Error('expected VALIDATION');
    }
    expect(result.error.data.issues).toEqual(refused);
    expect(kept).toMatchObject({ companyId: 'c1' });
    expect(kept).not.toHaveProperty('contact');
  });
});
