import { Badge } from '@shadalaya/react/badge';
import { dueLabel, dueState } from './task.format.js';

/**
 * A task's due date, from today: overdue in the destructive tone, due
 * today in the primary one. A done task is due nothing: its date is plain.
 */
export function TaskDueBadge({
  dueDate,
  done,
  now,
}: {
  readonly dueDate: string;
  readonly done: boolean;
  readonly now: Date;
}) {
  const state = done ? 'later' : dueState(dueDate, now);
  return (
    <Badge
      variant={
        state === 'overdue'
          ? 'destructive'
          : state === 'today'
            ? 'default'
            : 'outline'
      }
    >
      {dueLabel(dueDate, state)}
    </Badge>
  );
}
