import type { Migration } from '@latticecms/store-mongo';

/** Companies are found by name. A second run finds the index there. */
export default {
  id: 1,
  name: 'index-company-names',
  async up({ db }) {
    await db.collection('companies').createIndex({ name: 1 });
  },
} satisfies Migration;
