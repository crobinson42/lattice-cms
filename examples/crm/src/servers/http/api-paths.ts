/**
 * The paths the server answers itself: the API, sign-in, MCP, health and
 * the API's documents. Any other GET is the web page's, which routes in
 * the browser. The edge routes by this list, and Vite's dev server proxies
 * it to the server, so the two never disagree.
 */
export const apiPaths = [
  '/rpc',
  '/auth',
  '/mcp',
  '/health',
  '/openapi.json',
  '/catalog.json',
] as const;

/** Whether `pathname` is one of `apiPaths`, or under one. */
export function isApiPath(pathname: string): boolean {
  return apiPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}
