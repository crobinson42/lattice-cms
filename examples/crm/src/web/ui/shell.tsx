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
import type { ReactNode, Ref } from 'react';
import { Link, useLocation } from 'wouter';

/** A sidebar entry: a section of the app, and its icon. */
export type Section = {
  readonly href: string;
  readonly label: string;
  readonly icon: ReactNode;
};

/** Whether `location` is in the section at `href`, or under it. */
function inSection(location: string, href: string): boolean {
  return location === href || location.startsWith(`${href}/`);
}

/**
 * The frame of a page: the sidebar of sections, and a top bar with the
 * current section's title as the page's heading, then `actions`.
 */
export function Shell({
  sections,
  actions,
  headingRef,
  children,
}: {
  readonly sections: readonly Section[];
  readonly actions: ReactNode;
  /** The page's h1, for whoever moves focus to it. */
  readonly headingRef: Ref<HTMLHeadingElement>;
  readonly children: ReactNode;
}) {
  const [location] = useLocation();
  const current = sections.find(({ href }) => inSection(location, href));
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="px-4 py-3 font-semibold">CRM</SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {sections.map(({ href, label, icon }) => (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      isActive={href === current?.href}
                      render={<Link href={href} />}
                    >
                      {icon}
                      {label}
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
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-semibold outline-none"
          >
            {current?.label}
          </h1>
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </header>
        <main className="p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
