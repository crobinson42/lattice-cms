import { Button } from '@shadalaya/react/button';
import { ButtonGroup } from '@shadalaya/react/button-group';
import { asResult } from '@ts-pf/client';
import { ListChecksIcon, PlusIcon } from 'lucide-react';
import { type RefObject, useRef, useState } from 'react';
import useSWR from 'swr';
import { useApi } from '../api.js';
import { useCompanySearch } from '../resources/companies/company-search.js';
import { useContactSearch } from '../resources/contacts/contact-search.js';
import { useDealSearch } from '../resources/deals/deal-search.js';
import { taskCount } from '../resources/tasks/task.format.js';
import type { TaskCreate, TaskWhere } from '../resources/tasks/task.js';
import { TaskForm } from '../resources/tasks/task-form.js';
import { useAfterWrite } from '../ui/after-write.js';
import { FormSheet } from '../ui/form.js';
import { useUrlOption } from '../ui/list-params.js';
import { PageHeader } from '../ui/page-header.js';
import { EmptyState } from '../ui/states.js';
import { type Team, TeamGate } from '../workspace/team.js';
import { DoneTasks } from './done-tasks.js';
import { TaskList } from './task-list.js';
import { useTaskPages } from './task-pages.js';

const whose = ['everyone'] as const;

/**
 * The open tasks, the signed-in member's by default, everyone's with
 * `?who=everyone`: in one read sorted by due date, undated ones last, then
 * in groups by how near that is. The done ones are under them, behind a
 * button. New opens the form in a sheet, on a company, contact or deal.
 */
export default function TasksPage() {
  return <TeamGate>{(team) => <Tasks team={team} />}</TeamGate>;
}

function Tasks({ team }: { readonly team: Team }) {
  const { rpc, swr } = useApi();
  const afterWrite = useAfterWrite();
  const [who, setWho] = useUrlOption('who', whose);
  const mine = who === undefined;
  const where: TaskWhere = mine ? { assigneeId: { eq: team.me.userId } } : {};
  const open = { ...where, done: { eq: false } };
  // Missing due dates sort last, ascending too: undated work is neither
  // the most urgent nor the least.
  const pages = useTaskPages(open, ['dueDate', 'createdAt'], 50);
  const count = useSWR(
    swr.tasks.count.key({ input: { where: open } }),
    swr.tasks.count.fetcher(),
  );
  const done = useSWR(
    swr.tasks.count.key({ input: { where: { ...where, done: { eq: true } } } }),
    swr.tasks.count.fetcher(),
  );
  const searches = {
    companies: useCompanySearch(),
    contacts: useContactSearch(undefined, []),
    deals: useDealSearch(),
  };

  const [creating, setCreating] = useState(false);
  const create = async (input: TaskCreate) => {
    const result = await asResult(rpc.tasks.create(input));
    if (!result.ok) return result.error;
    setCreating(false);
    void afterWrite({
      changed: swr.tasks.matcher(),
      says: `Created ${result.data.title}`,
    });
    return undefined;
  };

  const newButton = useRef<HTMLButtonElement>(null);
  // The header's button holds the ref: focus goes there after a delete.
  const newTask = (ref?: RefObject<HTMLButtonElement | null>) => (
    <Button
      {...(ref === undefined ? {} : { ref })}
      onClick={() => setCreating(true)}
    >
      <PlusIcon />
      New task
    </Button>
  );
  return (
    <>
      <PageHeader
        title="Tasks"
        icon={<ListChecksIcon />}
        description={
          count.data === undefined
            ? undefined
            : `${taskCount(count.data.count)} open`
        }
        actions={
          <>
            <ButtonGroup aria-label="Whose tasks">
              <Button
                variant={mine ? 'default' : 'outline'}
                aria-pressed={mine}
                onClick={() => setWho(undefined)}
              >
                Mine
              </Button>
              <Button
                variant={mine ? 'outline' : 'default'}
                aria-pressed={!mine}
                onClick={() => setWho('everyone')}
              >
                Everyone
              </Button>
            </ButtonGroup>
            {newTask(newButton)}
          </>
        }
      />
      <TaskList
        label="Open tasks"
        pages={pages}
        team={team}
        on={undefined}
        grouped
        empty={
          mine ? (
            <EmptyState
              title="Nothing on your plate"
              description="Tasks assigned to you show up here."
              action={newTask()}
            />
          ) : (
            <EmptyState title="No open tasks" action={newTask()} />
          )
        }
        finalFocus={newButton}
      />
      <DoneTasks
        where={where}
        count={done.data?.count}
        team={team}
        on={undefined}
      />
      <FormSheet
        open={creating}
        onOpenChange={setCreating}
        title="New task"
        description="A title, and the company, contact or deal it is for."
      >
        <TaskForm
          members={team.members}
          me={team.me.userId}
          searches={searches}
          onSubmit={create}
        />
      </FormSheet>
    </>
  );
}
