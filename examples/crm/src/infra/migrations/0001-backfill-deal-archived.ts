import type { Migration } from '@latticecms/store-mongo';

/**
 * Deals written before `archived` existed have no such field, and the read
 * filter `archived: { eq: false }` would hide them. Every organization's
 * deals: a migration is system work, outside access and tenancy. The
 * filter skips the deals already done, so a second run changes nothing.
 */
export default {
  id: 1,
  name: 'backfill-deal-archived',
  async up({ db, logger }) {
    const { modifiedCount } = await db
      .collection('deals')
      .updateMany(
        { archived: { $exists: false } },
        { $set: { archived: false } },
      );
    logger.info('deals backfilled', { modifiedCount });
  },
} satisfies Migration;
