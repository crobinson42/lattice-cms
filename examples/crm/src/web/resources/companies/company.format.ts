/** "1 company", "12 companies". */
export function companyCount(count: number): string {
  return count === 1 ? '1 company' : `${count} companies`;
}

/**
 * The company's website, from its domain: "acme.test" opens
 * https://acme.test. A domain stored with its scheme keeps it.
 */
export function websiteUrl(domain: string): string {
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
}
