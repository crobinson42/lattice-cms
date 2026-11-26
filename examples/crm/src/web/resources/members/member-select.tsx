import { SelectField } from '../../ui/select-field.js';
import { displayName } from './member.format.js';
import type { Member } from './member.js';

/**
 * Picks one member of the team, or no one: "Unassigned" submits ''. The
 * team is small and loaded, so this is a plain select. A user id the team
 * no longer holds stays chosen, as "Former member", so a form that does
 * not change it sends nothing.
 */
export function MemberSelect({
  name,
  label,
  members,
  defaultValue,
  error,
}: {
  readonly name: string;
  readonly label: string;
  readonly members: readonly Member[];
  /** The chosen member's user id, or '' for no one. */
  readonly defaultValue: string;
  readonly error: string | undefined;
}) {
  const former =
    defaultValue !== '' &&
    !members.some(({ userId }) => userId === defaultValue);
  return (
    <SelectField
      name={name}
      label={label}
      defaultValue={defaultValue}
      options={[
        { value: '', label: 'Unassigned' },
        ...members.map((member) => ({
          value: member.userId,
          label: displayName(member),
        })),
        ...(former ? [{ value: defaultValue, label: 'Former member' }] : []),
      ]}
      error={error}
    />
  );
}
