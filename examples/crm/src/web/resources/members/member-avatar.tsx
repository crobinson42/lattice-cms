import { Avatar, AvatarFallback } from '@shadalaya/react/avatar';
import { Skeleton } from '@shadalaya/react/skeleton';
import { initials } from './member.format.js';
import type { Member } from './member.js';

/** A member's initials in a small avatar. */
export function MemberAvatar({ member }: { readonly member: Member }) {
  return (
    <Avatar size="sm">
      <AvatarFallback>{initials(member)}</AvatarFallback>
    </Avatar>
  );
}

/** MemberAvatar's place while the member loads. */
export function MemberAvatarSkeleton() {
  return <Skeleton className="size-6 rounded-full" />;
}
