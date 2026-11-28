import type { Member } from './member.js';

/** The name a member goes by in their organization. */
export function displayName(member: Pick<Member, 'name'>): string {
  return member.name;
}

/** Up to two initials of the member's name, for an avatar: "Ann Lee" → "AL". */
export function initials(member: Pick<Member, 'name'>): string {
  return displayName(member)
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

/** How a role reads: "Manager", "Member". */
export const roleLabels = {
  manager: 'Manager',
  member: 'Member',
} as const satisfies Record<Member['role'], string>;
