import { Button } from '@shadalaya/react/button';
import { Skeleton } from '@shadalaya/react/skeleton';
import { toast } from '@shadalaya/react/toast';
import { asResult } from '@ts-pf/client';
import { PencilIcon, Trash2Icon } from 'lucide-react';
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useApi } from '../api.js';
import { memberOf } from '../resources/members/member.js';
import type { Parent } from '../resources/parents.js';
import { dueGroups } from '../resources/tasks/task.format.js';
import type { Task, TaskPatch } from '../resources/tasks/task.js';
import { TaskForm } from '../resources/tasks/task-form.js';
import { TaskItem } from '../resources/tasks/task-item.js';
import { useAfterWrite } from '../ui/after-write.js';
import { ConfirmAction } from '../ui/confirm-action.js';
import { type CursorPages, LoadMore } from '../ui/cursor-pages.js';
import { FormSheet } from '../ui/form.js';
import { useNow } from '../ui/now.js';
import { useRowActions } from '../ui/row-actions.js';
import { ErrorState } from '../ui/states.js';
import type { Team } from '../workspace/team.js';

/**
 * A list of tasks, read a page at a time, with what each offers: done or
 * not in one click, Edit in a sheet, Delete behind a confirmation. The
 * Tasks page and each record's Tasks section show it.
 *
 * A click shows the box checked at once, from this list's own state, and
 * sends it; the cache is untouched until the server answers. Then the lists
 * read again, so the task moves to its list (Done, or back), focus goes to
 * the next row's box, and a toast offers Undo. A refusal clears the box and
 * says why. Several tasks may be on their way at once, one change each.
 */
export function TaskList({
  label,
  pages,
  team,
  on,
  grouped,
  empty,
  finalFocus,
}: {
  /** The list's name, for its region: "Open tasks". */
  readonly label: string;
  readonly pages: CursorPages<Task>;
  readonly team: Team;
  /** The record whose tasks these are, or undefined on the Tasks page. */
  readonly on: Parent['on'] | undefined;
  /** In groups by due date: Overdue, Today, This week, Later, none. */
  readonly grouped: boolean;
  readonly empty: ReactNode;
  /** Where focus goes when a row goes and no other is left to take it. */
  readonly finalFocus: RefObject<HTMLElement | null>;
}) {
  const { rpc, swr } = useApi();
  const afterWrite = useAfterWrite();
  const now = new Date(useNow(60_000));
  const groupId = useId();
  // Each task on its way, by id, with the done it is being set to.
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  );
  const sending = useRef(new Set<string>());
  const list = useRef<HTMLElement>(null);
  const [said, setSaid] = useState('');
  const [editing, setEditing] = useState<Task>();
  // After an edit, focus goes to the task's Edit button once the list has
  // read again, wherever its row is now; or, if it left the list, on.
  const [refocus, setRefocus] = useState<string>();
  const editButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (refocus === undefined) return;
    (editButton.current ?? finalFocus.current)?.focus();
    setRefocus(undefined);
  }, [refocus, finalFocus]);

  const rows = useRowActions({ changed: swr.tasks.matcher(), noun: 'task' });

  /** A row's checkbox, by its task's id, while it is on screen. */
  const checkbox = (id: string) =>
    list.current?.querySelector<HTMLElement>(
      `[data-task="${CSS.escape(id)}"] [role="checkbox"]`,
    );

  const setDone = async (task: Task, done: boolean) => {
    if (sending.current.has(task.id)) return;
    sending.current.add(task.id);
    // Where focus goes once the row leaves: the next row, or the one before.
    const ids = pages.rows?.map(({ id }) => id) ?? [];
    const at = ids.indexOf(task.id);
    const neighbor = ids[at + 1] ?? ids[at - 1];
    setPending((map) => new Map(map).set(task.id, done));
    const result = await asResult(rpc.tasks.update({ id: task.id, done }));
    if (result.ok) {
      const what = `${task.title} ${done ? 'done' : 'not done'}`;
      setSaid(`Marked ${what}`);
      toast.add({
        title: what,
        type: 'success',
        actionProps: {
          children: 'Undo',
          onClick: () => void setDone({ ...task, done }, !done),
        },
      });
      // The row moves to its list once the lists have read again.
      await afterWrite({ changed: swr.tasks.matcher() });
    } else if (!rows.gone(result.error)) {
      toast.add({ title: result.error.message, type: 'error' });
    }
    sending.current.delete(task.id);
    setPending((map) => {
      const next = new Map(map);
      next.delete(task.id);
      return next;
    });
    // Its box went with its row: focus goes on, not to the page's top.
    if (result.ok && document.activeElement === document.body) {
      (
        (neighbor === undefined ? undefined : checkbox(neighbor)) ??
        finalFocus.current
      )?.focus();
    }
  };

  const update = (task: Task) => async (patch: TaskPatch) => {
    if (Object.keys(patch).length === 0) {
      setEditing(undefined);
      return undefined;
    }
    const refused = await rows.save(
      asResult(rpc.tasks.update({ id: task.id, ...patch })),
      () => setEditing(undefined),
    );
    if (refused === undefined) setRefocus(task.id);
    return refused;
  };

  const remove = (task: Task) =>
    rows.remove(
      asResult(rpc.tasks.delete({ id: task.id })),
      `Deleted ${task.title}`,
    );

  const item = (task: Task) => (
    <li key={task.id} data-task={task.id}>
      <TaskItem
        task={{ ...task, done: pending.get(task.id) ?? task.done }}
        assignee={
          task.assigneeId === undefined
            ? undefined
            : memberOf(team.members, task.assigneeId)
        }
        on={on}
        now={now}
        onToggle={() => void setDone(task, !task.done)}
        actions={
          <>
            <Button
              ref={task.id === refocus ? editButton : undefined}
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit ${task.title}`}
              onClick={() => setEditing(task)}
            >
              <PencilIcon />
            </Button>
            <ConfirmAction
              trigger={
                <>
                  <Trash2Icon />
                  {/* The icon is hidden: this names the button. */}
                  <span className="sr-only">Delete {task.title}</span>
                </>
              }
              variant="ghost"
              size="icon-sm"
              // Its row goes: focus goes to what the list sits under.
              finalFocus={finalFocus}
              title={`Delete ${task.title}?`}
              description="This cannot be undone."
              confirm="Delete"
              pending="Deleting…"
              onConfirm={() => remove(task)}
            />
          </>
        }
      />
    </li>
  );

  return (
    <section ref={list} aria-label={label}>
      {/* Says a change once it is made. Mounted first, so it is heard. */}
      <div role="status" className="sr-only">
        {said}
      </div>
      {pages.rows === undefined ? (
        pages.error === undefined ? (
          <TaskListSkeleton />
        ) : (
          <ErrorState
            message="The tasks could not be loaded."
            onRetry={pages.refresh}
          />
        )
      ) : pages.rows.length === 0 ? (
        empty
      ) : grouped ? (
        <div className="grid gap-4">
          {dueGroups(pages.rows, (task) => task.dueDate, now).map((group) => (
            <section
              key={group.state}
              aria-labelledby={`${groupId}-${group.state}`}
            >
              <h3
                id={`${groupId}-${group.state}`}
                className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                {group.label}
              </h3>
              <ul className="divide-y">{group.items.map(item)}</ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="divide-y">{pages.rows.map(item)}</ul>
      )}
      <LoadMore pages={pages} what="tasks" />
      <FormSheet
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
        title={editing === undefined ? 'Edit task' : `Edit ${editing.title}`}
        description="Only what you change is saved."
      >
        {editing === undefined ? null : (
          <TaskForm
            task={editing}
            members={team.members}
            me={team.me.userId}
            onSubmit={update(editing)}
          />
        )}
      </FormSheet>
    </section>
  );
}

/** TaskList's place while its first page loads. */
function TaskListSkeleton() {
  return (
    <div className="grid gap-3 py-2">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}
