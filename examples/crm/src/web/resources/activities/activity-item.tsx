import type { ReactNode } from 'react';
import { RelativeTime } from '../../ui/relative-time.js';
import { isReadableContact } from '../contacts/contact.js';
import { ContactInline } from '../contacts/contact-inline.js';
import { isReadableDeal } from '../deals/deal.js';
import { DealInline } from '../deals/deal-inline.js';
import type { Member } from '../members/member.js';
import { MemberInline } from '../members/member-inline.js';
import type { Activity } from './activity.js';
import { activityKinds } from './activity-kinds.js';
import type { LoggedOn } from './activity-parents.js';

/**
 * One activity: its kind, its author, when, and what happened, with its
 * line breaks. Away from the deal or contact it was logged on, it links
 * there: on a company's timeline, a call on a deal says "on <deal>".
 * `actions` is its Edit and Delete, for its author.
 */
export function ActivityItem({
  activity,
  author,
  on,
  actions,
}: {
  readonly activity: Activity;
  /** The author, from the team, or undefined for a former member. */
  readonly author: Member | undefined;
  /** The timeline it shows on: its own parent goes without saying. */
  readonly on: LoggedOn['on'];
  readonly actions?: ReactNode;
}) {
  const { label, icon: Icon } = activityKinds[activity.kind];
  // Every parent but the timeline's own; the company goes without saying
  // on a deal's or a contact's timeline, as it is theirs.
  const deal = on === 'deal' ? undefined : activity.dealId;
  const contact = on === 'contact' ? undefined : activity.contactId;
  return (
    <article className="flex gap-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon aria-hidden className="size-4" />
      </div>
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground">by</span>
          <MemberInline member={author} />
          {deal === undefined ? null : (
            <span className="text-muted-foreground">
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
            <span className="text-muted-foreground">
              with{' '}
              {isReadableContact(contact) ? (
                <ContactInline contact={contact} />
              ) : (
                'a hidden contact'
              )}
            </span>
          )}
          <RelativeTime
            iso={activity.occurredAt}
            className="text-muted-foreground"
          />
          {actions === undefined ? null : (
            <span className="ml-auto flex gap-1">{actions}</span>
          )}
        </div>
        <p className="text-sm whitespace-pre-line">{activity.body}</p>
      </div>
    </article>
  );
}
