import { useApi } from '../api.js';
import type { TaskSort, TaskWhere } from '../resources/tasks/task.js';
import { useCursorPages } from '../ui/cursor-pages.js';

/**
 * What every task list reads with a task: its company, contact and deal.
 * Spread, it stays a tuple, which is what types the populated refs.
 */
const populate = ['companyId', 'contactId', 'dealId'] as const;

/**
 * The tasks `where` picks, sorted, `limit` at a time: what the Tasks page
 * and each record's Tasks section list.
 */
export function useTaskPages(where: TaskWhere, sort: TaskSort, limit: number) {
  const { swr } = useApi();
  return useCursorPages(
    swr.tasks.find.key,
    { where, sort, limit, populate: [...populate] },
    (input) => swr.tasks.find({ ...input, populate: [...populate] }),
  );
}
