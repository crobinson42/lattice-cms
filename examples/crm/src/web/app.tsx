import { Toaster } from '@shadalaya/react/toast';
import { lazy, Suspense } from 'react';
import { Redirect, Route, Switch } from 'wouter';
import { CompaniesPage } from './pages/companies-page.js';
import { CompanyPage } from './pages/company-page.js';
import { SignInPage } from './pages/sign-in-page.js';
import { SessionProvider } from './session.js';
import { SignedIn } from './signed-in.js';
import { ErrorBoundary, ErrorState, Loading } from './ui/states.js';
import { Workspace } from './workspace/workspace.js';

// The admin is its own chunk, with its own stylesheet, loaded when /admin
// first opens.
const AdminPage = lazy(() => import('./pages/admin-page.js'));

/** Every route of the app, in one table. */
export function App() {
  return (
    <Toaster>
      <SessionProvider>
        <Switch>
          <Route path="/sign-in" component={SignInPage} />
          <Route>
            <SignedIn>
              <Switch>
                <Route path="/admin" nest>
                  {/* A chunk that fails to load, such as an old hash after a
                    deploy, offers a reload. */}
                  <ErrorBoundary
                    fallback={
                      <ErrorState
                        message="The admin could not be loaded."
                        onRetry={() => window.location.reload()}
                      />
                    }
                  >
                    <Suspense fallback={<Loading />}>
                      <AdminPage />
                    </Suspense>
                  </ErrorBoundary>
                </Route>
                <Route>
                  <Workspace>
                    <Switch>
                      <Route path="/">
                        <Redirect to="/companies" replace />
                      </Route>
                      <Route path="/companies" component={CompaniesPage} />
                      <Route path="/companies/:id">
                        {({ id }) => <CompanyPage key={id} id={id} />}
                      </Route>
                      <Route>
                        <Redirect to="/" replace />
                      </Route>
                    </Switch>
                  </Workspace>
                </Route>
              </Switch>
            </SignedIn>
          </Route>
        </Switch>
      </SessionProvider>
    </Toaster>
  );
}
