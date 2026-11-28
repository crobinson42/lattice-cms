import {
  CalendarDaysIcon,
  type LucideIcon,
  MailIcon,
  PhoneIcon,
  StickyNoteIcon,
} from 'lucide-react';
import { oneOf } from '../../ui/form.js';
import type { ActivityLog } from './activity.js';

export type ActivityKind = ActivityLog['kind'];

const kinds = [
  'note',
  'call',
  'email',
  'meeting',
] as const satisfies readonly ActivityKind[];

/** How each kind reads, and its icon. */
export const activityKinds: Readonly<
  Record<ActivityKind, { readonly label: string; readonly icon: LucideIcon }>
> = {
  note: { label: 'Note', icon: StickyNoteIcon },
  call: { label: 'Call', icon: PhoneIcon },
  email: { label: 'Email', icon: MailIcon },
  meeting: { label: 'Meeting', icon: CalendarDaysIcon },
};

/** The kinds, in the order a select offers them. */
export const kindOptions = kinds.map((kind) => ({
  value: kind,
  label: activityKinds[kind].label,
}));

/** A kind, as a select of them gives it. */
export const parseKind = oneOf(kinds);
