import { Button } from '@shadalaya/react/button';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@shadalaya/react/command';
import {
  BriefcaseIcon,
  Building2Icon,
  ListChecksIcon,
  UserIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useLocation } from 'wouter';
import {
  type CompanyRef,
  isReadableCompany,
} from '../resources/companies/company.js';
import { dealStages } from '../resources/deals/deal-stages.js';
import {
  resultCount,
  type SearchState,
  useSearch,
} from '../resources/search.js';
import { sections } from './sections.js';

/** What the palette offers with nothing typed: a create sheet, by its URL. */
const creates = [
  { label: 'New company', href: '/companies?new=1', icon: <Building2Icon /> },
  { label: 'New deal', href: '/deals?new=1', icon: <BriefcaseIcon /> },
  { label: 'New task', href: '/tasks?new=1', icon: <ListChecksIcon /> },
];

/** A company's name in a secondary line, or what stands in for it. */
const companyName = (company: CompanyRef) =>
  isReadableCompany(company) ? company.name : 'Hidden company';

/** What the palette's live region says for a search. */
function said(state: SearchState): string {
  switch (state.status) {
    case 'idle':
      return '';
    case 'searching':
      return 'Searching…';
    case 'found':
      return resultCount(state.found);
    case 'none':
      return `No results for “${state.query}”`;
    case 'failed':
      return 'The search failed.';
  }
}

/**
 * The search palette: companies, contacts and deals by name or title, five
 * of each, as the user types; with nothing typed, the app's sections and
 * its create sheets. Filtering is the server's: cmdk shows what it found.
 * Enter or a click goes there and closes. The load is lazy: the top bar's
 * SearchButton opens it.
 */
export default function SearchPalette({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const { state, retry } = useSearch(query);
  const [, navigate] = useLocation();
  const close = (next: boolean) => {
    if (!next) setQuery('');
    onOpenChange(next);
  };
  const go = (href: string) => {
    close(false);
    navigate(href);
  };
  const item = (
    key: string,
    href: string,
    icon: ReactNode,
    label: string,
    detail?: string,
  ) => (
    <CommandItem key={key} value={key} onSelect={() => go(href)}>
      {icon}
      <span className="grid min-w-0">
        <span className="truncate">{label}</span>
        {detail === undefined ? null : (
          <span className="truncate text-xs text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
    </CommandItem>
  );
  return (
    <CommandDialog
      open={open}
      onOpenChange={close}
      title="Search"
      description="Search companies, contacts and deals, or go to a page."
      // Wide enough for a result's second line: its company and stage.
      className="sm:max-w-xl"
    >
      <Command shouldFilter={false} label="Search">
        <CommandInput
          placeholder="Search companies, contacts and deals…"
          value={query}
          onValueChange={setQuery}
        />
        {state.status === 'failed' ? (
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-destructive">
            The search failed.
            <Button size="sm" variant="outline" onClick={retry}>
              Try again
            </Button>
          </div>
        ) : null}
        <CommandList className="max-h-[min(28rem,60vh)]">
          {state.status === 'idle' ? (
            <>
              <CommandGroup heading="Go to">
                {sections.map(({ href, label, icon }) =>
                  item(`go ${href}`, href, icon, label),
                )}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Create">
                {creates.map(({ href, label, icon }) =>
                  item(`new ${href}`, href, icon, label),
                )}
              </CommandGroup>
            </>
          ) : state.status === 'found' ? (
            <>
              {state.found.companies.length === 0 ? null : (
                <CommandGroup heading="Companies">
                  {state.found.companies.map((company) =>
                    item(
                      `company ${company.id}`,
                      `/companies/${company.id}`,
                      <Building2Icon />,
                      company.name,
                    ),
                  )}
                </CommandGroup>
              )}
              {state.found.contacts.length === 0 ? null : (
                <CommandGroup heading="Contacts">
                  {state.found.contacts.map((contact) =>
                    item(
                      `contact ${contact.id}`,
                      `/contacts/${contact.id}`,
                      <UserIcon />,
                      contact.name,
                      companyName(contact.companyId),
                    ),
                  )}
                </CommandGroup>
              )}
              {state.found.deals.length === 0 ? null : (
                <CommandGroup heading="Deals">
                  {state.found.deals.map((deal) =>
                    item(
                      `deal ${deal.id}`,
                      `/deals/${deal.id}`,
                      <BriefcaseIcon />,
                      deal.title,
                      `${companyName(deal.companyId)} · ${dealStages[deal.stage].label}`,
                    ),
                  )}
                </CommandGroup>
              )}
            </>
          ) : null}
          {state.status === 'searching' || state.status === 'none' ? (
            <CommandEmpty>{said(state)}</CommandEmpty>
          ) : null}
        </CommandList>
        {/*
          Says what the search found. Inside the dialog: while it is open,
          Base UI hides everything else from assistive tech.
        */}
        <div role="status" className="sr-only">
          {said(state)}
        </div>
      </Command>
    </CommandDialog>
  );
}
