import { expect, it } from 'vitest';
import { dueGroups, dueLabel, dueState, taskCount } from './task.format.js';

// Behind UTC: at 18:00 on the 26th in Honolulu it is already the 27th in
// UTC, and "today" must still be the 26th. Node reads TZ again when it
// changes; nothing here has made a date yet.
process.env.TZ = 'Pacific/Honolulu';

const now = new Date(2026, 10, 26, 18, 0);

it('reads a due date from today in the browser’s time zone', () => {
  expect(now.toISOString().slice(0, 10)).toBe('2026-11-27');
  expect(dueState('2026-11-25', now)).toBe('overdue');
  expect(dueState('2026-11-26', now)).toBe('today');
  expect(dueState('2026-11-27', now)).toBe('soon');
  expect(dueState('2026-12-03', now)).toBe('soon');
  expect(dueState('2026-12-04', now)).toBe('later');
  expect(dueState(undefined, now)).toBe('none');
});

it('says a due date in words', () => {
  expect(dueLabel('2026-11-20', 'overdue')).toBe('Overdue, Nov 20, 2026');
  expect(dueLabel('2026-11-26', 'today')).toBe('Due today');
  expect(dueLabel('2026-12-01', 'soon')).toBe('Due Dec 1, 2026');
});

it('groups sorted tasks by due state, the undated last', () => {
  const tasks = [
    { id: 'a', dueDate: '2026-11-20' },
    { id: 'b', dueDate: '2026-11-25' },
    { id: 'c', dueDate: '2026-11-26' },
    { id: 'd', dueDate: '2026-11-30' },
    { id: 'e', dueDate: '2027-01-10' },
    { id: 'f', dueDate: undefined },
  ];
  expect(
    dueGroups(tasks, (task) => task.dueDate, now).map(({ label, items }) => [
      label,
      items.map(({ id }) => id),
    ]),
  ).toEqual([
    ['Overdue', ['a', 'b']],
    ['Today', ['c']],
    ['This week', ['d']],
    ['Later', ['e']],
    ['No due date', ['f']],
  ]);
  expect(dueGroups([], () => undefined, now)).toEqual([]);
});

it('counts tasks', () => {
  expect(taskCount(1)).toBe('1 task');
  expect(taskCount(3)).toBe('3 tasks');
});
