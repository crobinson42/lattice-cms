import { Button } from '@shadalaya/react/button';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { type RefObject, useId, useRef, useState } from 'react';
import type { Parent } from '../resources/parents.js';
import type { TaskWhere } from '../resources/tasks/task.js';
import { EmptyState } from '../ui/states.js';
import type { Team } from '../workspace/team.js';
import { TaskList } from './task-list.js';
import { useTaskPages } from './task-pages.js';

/**
 * The done tasks that `where` picks, behind a button, so a list of what is
 * left stays short: recent first, read only once shown. `count`, when
 * known, says how many are behind it; with none, there is no button.
 */
export function DoneTasks({
  where,
  count,
  team,
  on,
}: {
  readonly where: TaskWhere;
  readonly count: number | undefined;
  readonly team: Team;
  readonly on: Parent['on'] | undefined;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  // None done: no button. Once shown, it stays while the list is open, so
  // unchecking the last one leaves focus somewhere to go.
  if ((count ?? 0) === 0 && !shown) return null;
  return (
    <div className="mt-4">
      <Button
        ref={toggle}
        variant="ghost"
        size="sm"
        aria-expanded={shown}
        aria-controls={id}
        onClick={() => setShown(!shown)}
      >
        {shown ? <ChevronDownIcon /> : <ChevronRightIcon />}
        {shown ? 'Hide done' : 'Show done'}
        {count === undefined ? '' : ` (${count})`}
      </Button>
      <div id={id}>
        {shown ? (
          <Done where={where} team={team} on={on} finalFocus={toggle} />
        ) : null}
      </div>
    </div>
  );
}

function Done({
  where,
  team,
  on,
  finalFocus,
}: {
  readonly where: TaskWhere;
  readonly team: Team;
  readonly on: Parent['on'] | undefined;
  readonly finalFocus: RefObject<HTMLButtonElement | null>;
}) {
  const pages = useTaskPages(
    { ...where, done: { eq: true } },
    ['-updatedAt'],
    20,
  );
  return (
    <TaskList
      label="Done tasks"
      pages={pages}
      team={team}
      on={on}
      grouped={false}
      loadMore
      empty={<EmptyState title="Nothing done yet" />}
      finalFocus={finalFocus}
    />
  );
}
