import { Avatar, AvatarFallback } from '@shadalaya/react/avatar';
import { displayName } from './member.format.js';
import type { Member } from './member.js';
import { MemberAvatar } from './member-avatar.js';

/**
 * A member's avatar and name. An id the team does not hold, such as a
 * member who left, shows as a former member.
 */
export function MemberInline({
  member,
}: {
  readonly member: Member | undefined;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      {member === undefined ? (
        <>
          <Avatar size="sm">
            <AvatarFallback>?</AvatarFallback>
          </Avatar>
          <span className="text-muted-foreground">Former member</span>
        </>
      ) : (
        <>
          <MemberAvatar member={member} />
          {displayName(member)}
        </>
      )}
    </span>
  );
}
