// Money and dates as the app shows them, in the browser's locale and time
// zone.

/** The app's one currency. */
const currency = 'USD';

/** An amount in whole units of the app's currency: "$12,500". */
export function formatMoney(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * A plain date, such as "2026-12-01", as that day wherever the browser is:
 * "Dec 1, 2026". A date has no time, so it is read as local, not UTC.
 */
export function formatDay(isoDate: string): string {
  const [year = 0, month = 1, day = 1] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    new Date(year, month - 1, day),
  );
}

/** A date-time as a date: "Nov 25, 2026". */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    new Date(iso),
  );
}

const units = [
  ['year', 365 * 24 * 60 * 60_000],
  ['month', 30 * 24 * 60 * 60_000],
  ['week', 7 * 24 * 60 * 60_000],
  ['day', 24 * 60 * 60_000],
  ['hour', 60 * 60_000],
  ['minute', 60_000],
] as const;

/** A date-time relative to now: "3 days ago", "in 2 hours". */
export function formatRelative(iso: string, now = Date.now()): string {
  const elapsed = Date.parse(iso) - now;
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (Math.abs(elapsed) >= size) {
      return format.format(Math.round(elapsed / size), unit);
    }
  }
  return format.format(0, 'minute');
}
