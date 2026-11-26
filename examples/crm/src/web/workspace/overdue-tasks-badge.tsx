import { SidebarMenuBadge } from '@shadalaya/react/sidebar';
import useSWR from 'swr';
import { useApi } from '../api.js';
import { useSignedIn } from '../signed-in.js';
import { isoDay } from '../ui/format.js';
import { useNow } from '../ui/now.js';

/**
 * How many of the signed-in member's open tasks are overdue, beside Tasks
 * in the sidebar, or nothing when none is. One count, read again on focus,
 * after a task write, and when the day turns.
 */
export function OverdueTasksBadge() {
  const { userId } = useSignedIn();
  const { swr } = useApi();
  const today = isoDay(new Date(useNow(60_000)));
  const overdue = useSWR(
    swr.tasks.count.key({
      input: {
        where: {
          assigneeId: { eq: userId },
          done: { eq: false },
          dueDate: { lt: today },
        },
      },
    }),
    swr.tasks.count.fetcher(),
  );
  const count = overdue.data?.count ?? 0;
  if (count === 0) return null;
  return (
    <>
      {/* Inline, so the link's name reads "Tasks, 1 overdue": the badge is
          a block, which would part its words from the label's. */}
      <span className="sr-only">, {count} overdue</span>
      <SidebarMenuBadge
        aria-hidden
        className="bg-destructive/10 text-destructive"
      >
        {count}
      </SidebarMenuBadge>
    </>
  );
}
