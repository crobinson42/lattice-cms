import {
  NativeSelect,
  NativeSelectOption,
} from '@shadalaya/react/native-select';
import { useSignedIn } from '../signed-in.js';

/**
 * Picks the organization the session acts in, from /auth organizations. A
 * native select: one control for the app's top bar and the admin's header.
 */
export function OrganizationSwitcher() {
  const { organizations, organization, pick, switcherRef } = useSignedIn();
  if (organization === undefined) return null;
  return (
    <NativeSelect
      ref={switcherRef}
      aria-label="Organization"
      size="sm"
      value={organization.id}
      onChange={(event) => pick(event.target.value)}
    >
      {organizations.map(({ id, name }) => (
        <NativeSelectOption key={id} value={id}>
          {name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
