import { Checkbox } from '@shadalaya/react/checkbox';
import { type ReactNode, useId } from 'react';
import { CompanyInline } from '../companies/company-inline.js';
import { isReadableContact } from '../contacts/contact.js';
import { ContactInline } from '../contacts/contact-inline.js';
import { isReadableDeal } from '../deals/deal.js';
import { DealInline } from '../deals/deal-inline.js';
import { displayName } from '../members/member.format.js';
import type { Member } from '../members/member.js';
import { MemberAvatar } from '../members/member-avatar.js';
import type { Parent } from '../parents.js';
import type { Task } from './task.js';
import { TaskDueBadge } from './task-due-badge.js';

/**
 * One task: a checkbox that marks it done or not in one click, its title,
 * struck through when done, its due date, and who it is for. Away from its
 * record it links there: "on <deal>", "with <contact>", "for <company>".
 * `actions` is its Edit and Delete.
 */
export function TaskItem({
  task,
  assignee,
  on,
  now,
  onToggle,
  actions,
}: {
  readonly task: Task;
  /** The assignee, from the team, or undefined for a former member. */
  readonly assignee: Member | undefined;
  /** The record whose tasks these are, or undefined on the Tasks page. */
  readonly on: Parent['on'] | undefined;
  readonly now: Date;
  readonly onToggle: () => void;
  readonly actions: ReactNode;
}) {
  const titleId = useId();
  const deal = on === 'deal' ? undefined : task.dealId;
  const contact = on === 'contact' ? undefined : task.contactId;
  // On a record, the company goes without saying: it is the record's own.
  const company = on === undefined ? task.companyId : undefined;
  return (
    <article className="flex items-start gap-3 py-2">
      <Checkbox
        className="mt-0.5"
        checked={task.done}
        aria-labelledby={titleId}
        onCheckedChange={onToggle}
      />
      <div className="grid min-w-0 flex-1 gap-1">
        <span
          id={titleId}
          className={
            task.done ? 'text-muted-foreground line-through' : 'font-medium'
          }
        >
          {task.title}
        </span>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {task.dueDate === undefined ? null : (
            <TaskDueBadge dueDate={task.dueDate} done={task.done} now={now} />
          )}
          {deal === undefined ? null : (
            <span>
              on{' '}
              {isReadableDeal(deal) ? (
                <DealInline deal={deal} />
              ) : (
                // A member reads every live deal: one withheld is archived.
                'an archived deal'
              )}
            </span>
          )}
          {contact === undefined ? null : (
            <span>
              with{' '}
              {isReadableContact(contact) ? (
                <ContactInline contact={contact} />
              ) : (
                'a hidden contact'
              )}
            </span>
          )}
          {company === undefined ? null : (
            <span>
              for <CompanyInline company={company} />
            </span>
          )}
        </div>
      </div>
      {task.assigneeId === undefined ? null : (
        <span
          className="shrink-0"
          title={
            assignee === undefined ? 'Former member' : displayName(assignee)
          }
        >
          {assignee === undefined ? null : <MemberAvatar member={assignee} />}
          <span className="sr-only">
            Assigned to{' '}
            {assignee === undefined ? 'a former member' : displayName(assignee)}
          </span>
        </span>
      )}
      <span className="flex shrink-0 gap-1">{actions}</span>
    </article>
  );
}
