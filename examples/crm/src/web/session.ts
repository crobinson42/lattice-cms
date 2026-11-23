import { organizationHeader } from '../servers/http/headers.js';

// The session lives for the tab: a reload keeps it, a new tab signs in.
const tokenKey = 'crm.token';
const organizationKey = 'crm.organization';

export const session = {
  token: () => sessionStorage.getItem(tokenKey),
  organization: () => sessionStorage.getItem(organizationKey),
  signIn: (token: string) => sessionStorage.setItem(tokenKey, token),
  pick: (organizationId: string) =>
    sessionStorage.setItem(organizationKey, organizationId),
  clear: () => sessionStorage.clear(),
};

/**
 * The fetch the admin and the auth client use: it adds the session token
 * and, once one is picked, the organization. A 401 means the session ended.
 */
export function sessionFetch(
  token: string,
  organizationId: string | undefined,
  onUnauthorized: () => void,
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    request.headers.set('authorization', `Bearer ${token}`);
    if (organizationId !== undefined) {
      request.headers.set(organizationHeader, organizationId);
    }
    const response = await fetch(request);
    if (response.status === 401) onUnauthorized();
    return response;
  };
}
