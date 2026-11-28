import { Badge } from '@shadalaya/react/badge';
import {
  type DealContactRole,
  dealContactRoles,
} from './deal-contact-roles.js';

/** What a contact is to a deal, as a badge. */
export function DealContactRoleBadge({
  role,
}: {
  readonly role: DealContactRole;
}) {
  return (
    <Badge variant={role === 'decision_maker' ? 'default' : 'secondary'}>
      {dealContactRoles[role]}
    </Badge>
  );
}
