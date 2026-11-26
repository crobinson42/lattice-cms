import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shadalaya/react/dropdown-menu';
import { DatabaseIcon, LogOutIcon } from 'lucide-react';
import { Link } from 'wouter';
import { displayName } from '../resources/members/member.format.js';
import type { Member } from '../resources/members/member.js';
import {
  MemberAvatar,
  MemberAvatarSkeleton,
} from '../resources/members/member-avatar.js';

/**
 * The signed-in member, with a link to the admin and sign-out. `member` is
 * undefined until it loads.
 */
export function UserMenu({
  member,
  userId,
  onSignOut,
}: {
  readonly member: Member | undefined;
  readonly userId: string;
  readonly onSignOut: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="User menu"
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {member === undefined ? (
          <MemberAvatarSkeleton />
        ) : (
          <MemberAvatar member={member} />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {member === undefined ? null : (
              <div className="font-medium text-foreground">
                {displayName(member)}
              </div>
            )}
            <div className="text-xs">{userId}</div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/admin" />}>
          <DatabaseIcon />
          Admin
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onSignOut}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
