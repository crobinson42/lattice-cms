import { Badge } from '@shadalaya/react/badge';
import type { Column } from '../../ui/data-table.js';
import { roleLabels } from './member.format.js';
import type { Member } from './member.js';
import { MemberInline } from './member-inline.js';

/**
 * What a table of the team shows: each member, "You" beside the signed-in
 * one, whose user id is `me`, and their role.
 */
export function memberColumns(me: string): readonly Column<Member>[] {
  return [
    {
      key: 'name',
      header: 'Name',
      cell: (member) => (
        <span className="inline-flex items-center gap-2">
          <MemberInline member={member} />
          {member.userId === me ? <Badge variant="outline">You</Badge> : null}
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (member) => (
        <Badge variant={member.role === 'manager' ? 'default' : 'secondary'}>
          {roleLabels[member.role]}
        </Badge>
      ),
    },
  ];
}
