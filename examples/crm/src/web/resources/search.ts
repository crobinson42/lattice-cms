import { useEffect, useState } from 'react';
import { useCompanySearch } from './companies/company-search.js';
import type { CompanyOption } from './companies/company-select.js';
import { useContactSearch } from './contacts/contact-search.js';
import type { ContactOption } from './contacts/contact-select.js';
import { useDealSearch } from './deals/deal-search.js';
import type { DealOption } from './deals/deal-select.js';

/** What one search found, in each resource. */
export type Found = {
  readonly companies: readonly CompanyOption[];
  readonly contacts: readonly ContactOption[];
  readonly deals: readonly DealOption[];
};

/** The last search's answer, with the query it answered. */
type Answer =
  | { readonly query: string; readonly found: Found }
  | { readonly query: string; readonly failed: true };

/** What a search shows for the query typed now. */
export type SearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'searching'; readonly query: string }
  | { readonly status: 'found'; readonly query: string; readonly found: Found }
  | { readonly status: 'none'; readonly query: string }
  | { readonly status: 'failed'; readonly query: string };

/** How many of each resource a search shows. */
const limit = 5;

/**
 * What to show for `query`, from the last answer: an answer to another
 * query, typed past, is never shown; until this one's arrives, it is
 * searching. Nothing typed is idle.
 */
export function searchState(
  answer: Answer | undefined,
  query: string,
): SearchState {
  const searched = query.trim();
  if (searched === '') return { status: 'idle' };
  if (answer?.query !== searched)
    return { status: 'searching', query: searched };
  if ('failed' in answer) return { status: 'failed', query: searched };
  const { found } = answer;
  return found.companies.length + found.contacts.length + found.deals.length ===
    0
    ? { status: 'none', query: searched }
    : { status: 'found', query: searched, found };
}

/** How many a search found, in words: "3 results". */
export function resultCount({ companies, contacts, deals }: Found): string {
  const count = companies.length + contacts.length + deals.length;
  return count === 1 ? '1 result' : `${count} results`;
}

/**
 * Companies, contacts and deals at once, by their names and titles, five
 * of each, through each resource's own search. It waits for a pause in the
 * typing, and cancels a search the user has typed past. `retry` asks again.
 */
export function useSearch(query: string) {
  const companies = useCompanySearch(limit);
  const contacts = useContactSearch(undefined, [], limit);
  const deals = useDealSearch(limit);
  const [answer, setAnswer] = useState<Answer>();
  const [attempt, setAttempt] = useState(0);
  const searched = query.trim();
  useEffect(() => {
    // Read so that a retry, which changes it, searches again.
    void attempt;
    if (searched === '') return;
    const controller = new AbortController();
    const { signal } = controller;
    const timer = setTimeout(() => {
      Promise.all([
        companies(searched, signal),
        contacts(searched, signal),
        deals(searched, signal),
      ]).then(
        ([c, k, d]) =>
          setAnswer({
            query: searched,
            found: { companies: c, contacts: k, deals: d },
          }),
        () => {
          if (!signal.aborted) setAnswer({ query: searched, failed: true });
        },
      );
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searched, attempt, companies, contacts, deals]);
  return {
    state: searchState(answer, query),
    retry: () => {
      setAnswer(undefined);
      setAttempt((n) => n + 1);
    },
  };
}
