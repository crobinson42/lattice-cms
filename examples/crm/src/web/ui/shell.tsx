import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@shadalaya/react/breadcrumb';
import { Separator } from '@shadalaya/react/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@shadalaya/react/sidebar';
import {
  createContext,
  Fragment,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import { Link, useLocation } from 'wouter';

/** A sidebar entry: a section of the app, and its icon. */
export type Section = {
  readonly href: string;
  readonly label: string;
  readonly icon: ReactNode;
  /**
   * A count beside it, such as overdue tasks, or nothing. It is inside the
   * link, so it is part of the link's name: "Tasks, 1 overdue".
   */
  readonly badge?: ReactNode;
};

/** A page above the current one, in the breadcrumb. */
export type Crumb = { readonly label: string; readonly href: string };

type Trail = { readonly parents: readonly Crumb[]; readonly title: string };

const TrailContext = createContext<(trail: Trail | undefined) => void>(
  () => {},
);

/**
 * Puts the page in the top bar's breadcrumb while it is shown: `parents`,
 * then `title`. PageHeader calls it, so the shell knows no page.
 */
export function useBreadcrumb(parents: readonly Crumb[], title: string) {
  const setTrail = useContext(TrailContext);
  useEffect(() => {
    setTrail({ parents, title });
    return () => setTrail(undefined);
  }, [setTrail, parents, title]);
}

/** Whether `location` is in the section at `href`, or under it. */
function inSection(location: string, href: string): boolean {
  return location === href || location.startsWith(`${href}/`);
}

/**
 * The frame of a page: the sidebar of sections, and a top bar with the
 * page's breadcrumb, then `actions`. Until the page says where it is, the
 * breadcrumb is its section. The page has its own heading.
 */
export function Shell({
  sections,
  actions,
  children,
}: {
  readonly sections: readonly Section[];
  readonly actions: ReactNode;
  readonly children: ReactNode;
}) {
  const [location] = useLocation();
  const current = sections.find(({ href }) => inSection(location, href));
  const [trail, setTrail] = useState<Trail>();
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="px-4 py-3 font-semibold">CRM</SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {sections.map(({ href, label, icon, badge }) => (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      isActive={href === current?.href}
                      render={<Link href={href} />}
                    >
                      {icon}
                      {label}
                      {badge}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              {trail?.parents.map(({ label, href }) => (
                <Fragment key={href}>
                  <BreadcrumbItem>
                    <BreadcrumbLink render={<Link href={href} />}>
                      {label}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                </Fragment>
              ))}
              <BreadcrumbItem>
                <BreadcrumbPage>
                  {trail?.title ?? current?.label}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </header>
        <main className="p-6">
          <TrailContext value={setTrail}>{children}</TrailContext>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
