// The admin and its stylesheet load with this chunk only, when /admin
// first opens: app.tsx imports this module through React.lazy. admin.css
// brings the theme's neutral colors again, so the app's palette follows it.
import '@latticecms/admin/admin.css';
import '@shadalaya/theme/atalaya.css';
import { Admin } from '@latticecms/admin';
import { Button } from '@shadalaya/react/button';
import { Link } from 'wouter';
import { useApi } from '../api.js';
import { useSignedIn } from '../signed-in.js';
import { OrganizationSwitcher } from '../ui/organization-switcher.js';

/**
 * `@latticecms/admin` at /admin, on the session's own fetch, in the picked
 * organization. A switch remounts it with an empty cache, as it does every
 * page (api.tsx). Support acts in none, so it gets the admin with no switcher and no way
 * back to an app it has no organization in.
 */
export default function AdminPage() {
  const { organization, signOut } = useSignedIn();
  const { fetch } = useApi();
  return (
    <Admin
      fetch={fetch}
      catalogUrl="/catalog.json"
      basePath="/admin"
      header={
        <div className="flex items-center gap-2">
          {organization === undefined ? null : (
            // `~` leaves the nested /admin route for the app's root.
            <Link
              href="~/"
              className="text-sm underline-offset-4 hover:underline"
            >
              Back to CRM
            </Link>
          )}
          <OrganizationSwitcher />
          <Button size="sm" variant="outline" onClick={signOut}>
            Sign out
          </Button>
        </div>
      }
    />
  );
}
