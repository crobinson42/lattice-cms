import type { Migration } from '@latticecms/store-mongo';

/**
 * Memberships written before `name` existed have none, though the schema
 * requires it: a team list would get no name, and an update fails until the
 * membership has one. Each takes its user id as its name. Every organization's
 * memberships: a migration is system work, outside access. The filter skips
 * the memberships already done, so a second run changes nothing.
 */
export default {
  id: 2,
  name: 'backfill-membership-name',
  async up({ db, logger }) {
    // A pipeline update, so each document copies its own userId.
    const { modifiedCount } = await db
      .collection('memberships')
      .updateMany({ name: { $exists: false } }, [
        { $set: { name: '$userId' } },
      ]);
    logger.info('memberships backfilled', { modifiedCount });
  },
} satisfies Migration;
