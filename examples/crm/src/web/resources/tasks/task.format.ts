import { formatDay, isoDay } from '../../ui/format.js';

/** How near a task's due date is, from today in the browser's time zone. */
export type DueState = 'overdue' | 'today' | 'soon' | 'later' | 'none';

/** Days ahead that count as soon: "This week". */
const soonDays = 7;

/**
 * A due date's state on `now`'s local day: before today is overdue; today;
 * within the next seven days, soon; after that, later; no date, none. Due
 * dates are plain dates, so they compare as ISO strings.
 */
export function dueState(dueDate: string | undefined, now: Date): DueState {
  if (dueDate === undefined) return 'none';
  const today = isoDay(now);
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  const soon = isoDay(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + soonDays),
  );
  return dueDate <= soon ? 'soon' : 'later';
}

/** What a due badge says: "Overdue, Nov 20, 2026", "Due today". */
export function dueLabel(dueDate: string, state: DueState): string {
  switch (state) {
    case 'overdue':
      return `Overdue, ${formatDay(dueDate)}`;
    case 'today':
      return 'Due today';
    default:
      return `Due ${formatDay(dueDate)}`;
  }
}

/** The open tasks' groups, in order, each with its heading. */
export const dueGroupLabels = {
  overdue: 'Overdue',
  today: 'Today',
  soon: 'This week',
  later: 'Later',
  none: 'No due date',
} as const satisfies Record<DueState, string>;

/** A run of tasks in one due state. */
export type DueGroup<T> = {
  readonly state: DueState;
  readonly label: string;
  readonly items: readonly T[];
};

/**
 * Splits tasks, sorted by due date with undated ones last, into runs by
 * due state: Overdue, Today, This week, Later, then No due date. A state
 * with no tasks has no group.
 */
export function dueGroups<T>(
  tasks: readonly T[],
  due: (task: T) => string | undefined,
  now: Date,
): readonly DueGroup<T>[] {
  const groups: { state: DueState; label: string; items: T[] }[] = [];
  for (const task of tasks) {
    const state = dueState(due(task), now);
    const last = groups.at(-1);
    if (last?.state === state) last.items.push(task);
    else groups.push({ state, label: dueGroupLabels[state], items: [task] });
  }
  return groups;
}

/** "3 tasks". */
export function taskCount(count: number): string {
  return count === 1 ? '1 task' : `${count} tasks`;
}
