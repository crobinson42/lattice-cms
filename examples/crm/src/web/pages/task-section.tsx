import { asResult } from '@ts-pf/client';
import { useRef } from 'react';
import useSWR from 'swr';
import { useApi } from '../api.js';
import { type Parent, whereOn } from '../resources/parents.js';
import type { TaskCreate } from '../resources/tasks/task.js';
import { TaskQuickAdd } from '../resources/tasks/task-quick-add.js';
import { useAfterWrite } from '../ui/after-write.js';
import { Section } from '../ui/section.js';
import { EmptyState } from '../ui/states.js';
import { type Team, TeamGate } from '../workspace/team.js';
import { DoneTasks } from './done-tasks.js';
import { TaskList } from './task-list.js';
import { useTaskPages } from './task-pages.js';

/**
 * A record's tasks: a quick add on top, for the signed-in member, then
 * the open ones by due date, and the done ones behind "Show done (n)". The
 * company, contact and deal pages share it.
 */
export function TaskSection({
  parent,
  name,
}: {
  /** What the page shows, and so what a task is added on. */
  readonly parent: Parent;
  /** Its name, for the list's label: "Tasks on Acme". */
  readonly name: string;
}) {
  return (
    <Section id="tasks" title="Tasks">
      <TeamGate>
        {(team) => <Tasks parent={parent} name={name} team={team} />}
      </TeamGate>
    </Section>
  );
}

function Tasks({
  parent,
  name,
  team,
}: {
  readonly parent: Parent;
  readonly name: string;
  readonly team: Team;
}) {
  const { rpc, swr } = useApi();
  const afterWrite = useAfterWrite();
  const where = whereOn(parent);
  const pages = useTaskPages(
    { ...where, done: { eq: false } },
    ['dueDate', 'createdAt'],
    20,
  );
  const done = useSWR(
    swr.tasks.count.key({ input: { where: { ...where, done: { eq: true } } } }),
    swr.tasks.count.fetcher(),
  );
  // A deleted task's row goes: focus goes back to the quick add.
  const quickAdd = useRef<HTMLDivElement>(null);

  const add = async (input: TaskCreate) => {
    const result = await asResult(rpc.tasks.create(input));
    if (!result.ok) return result.error;
    void afterWrite({
      changed: swr.tasks.matcher(),
      says: `Added ${result.data.title}`,
    });
    return undefined;
  };

  return (
    <div className="grid gap-4">
      <div ref={quickAdd} tabIndex={-1} className="outline-none">
        <TaskQuickAdd parent={parent} me={team.me.userId} onSubmit={add} />
      </div>
      <TaskList
        label={`Tasks on ${name}`}
        pages={pages}
        team={team}
        on={parent.on}
        grouped={false}
        empty={<EmptyState title="No open tasks" />}
        finalFocus={quickAdd}
      />
      <DoneTasks
        where={where}
        count={done.data?.count}
        team={team}
        on={parent.on}
      />
    </div>
  );
}
