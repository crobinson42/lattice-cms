import type { Env } from '@hexok/auth';

/**
 * The users who act as support: every call reads across organizations and
 * changes nothing. From `CRM_SUPPORT_USER_IDS`, comma separated, so only
 * whoever sets the deploy's config can grant it, never a request.
 */
export function supportUserIds(env: Env): ReadonlySet<string> {
  return new Set(
    (env.CRM_SUPPORT_USER_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== ''),
  );
}
