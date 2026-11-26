import { Toaster } from '@shadalaya/react/toast';
import { lazy } from 'react';
import { Redirect, Route, Switch } from 'wouter';
import { SignInPage } from './pages/sign-in-page.js';
import { SessionProvider } from './session.js';
import { SignedIn } from './signed-in.js';
import { LazyPage } from './ui/lazy-page.js';
import { DetailPageSkeleton, ListPageSkeleton } from './ui/page-skeleton.js';
import { Loading } from './ui/states.js';
import { Workspace } from './workspace/workspace.js';

// Each page is a chunk of its own, loaded when it first opens, so startup
// does not grow with each resource. Sign-in stays in the startup bundle: it
// is the first page a signed-out user sees. The admin brings its own
// stylesheet with its chunk.
const AdminPage = lazy(() => import('./pages/admin-page.js'));
const CompaniesPage = lazy(() => import('./pages/companies-page.js'));
const CompanyPage = lazy(() => import('./pages/company-page.js'));
const ContactsPage = lazy(() => import('./pages/contacts-page.js'));
const ContactPage = lazy(() => import('./pages/contact-page.js'));
const DealsPage = lazy(() => import('./pages/deals-page.js'));
const DealPage = lazy(() => import('./pages/deal-page.js'));
const TasksPage = lazy(() => import('./pages/tasks-page.js'));

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
                  <LazyPage fallback={<Loading />}>
                    <AdminPage />
                  </LazyPage>
                </Route>
                <Route>
                  <Workspace>
                    <Switch>
                      <Route path="/">
                        <Redirect to="/companies" replace />
                      </Route>
                      <Route path="/companies">
                        <LazyPage fallback={<ListPageSkeleton />}>
                          <CompaniesPage />
                        </LazyPage>
                      </Route>
                      <Route path="/companies/:id">
                        {({ id }) => (
                          <LazyPage fallback={<DetailPageSkeleton />}>
                            <CompanyPage key={id} id={id} />
                          </LazyPage>
                        )}
                      </Route>
                      <Route path="/contacts">
                        <LazyPage fallback={<ListPageSkeleton />}>
                          <ContactsPage />
                        </LazyPage>
                      </Route>
                      <Route path="/contacts/:id">
                        {({ id }) => (
                          <LazyPage fallback={<DetailPageSkeleton />}>
                            <ContactPage key={id} id={id} />
                          </LazyPage>
                        )}
                      </Route>
                      <Route path="/deals">
                        <LazyPage fallback={<ListPageSkeleton />}>
                          <DealsPage />
                        </LazyPage>
                      </Route>
                      <Route path="/deals/:id">
                        {({ id }) => (
                          <LazyPage fallback={<DetailPageSkeleton />}>
                            <DealPage key={id} id={id} />
                          </LazyPage>
                        )}
                      </Route>
                      <Route path="/tasks">
                        <LazyPage fallback={<ListPageSkeleton />}>
                          <TasksPage />
                        </LazyPage>
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
