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

/** A day as an ISO date, in the browser's time zone: "2026-12-01". */
export function isoDay(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The start of `now`'s month in the browser's time zone, as an ISO
 * date-time: what a `closedAt: { gte }` takes for "this month".
 */
export function monthStart(now: Date): string {
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

/** A date-time with its time: "Nov 25, 2026, 9:30 AM". */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

/**
 * A date-time as a datetime-local input shows it, in the browser's time
 * zone, to the minute: "2026-11-26T09:30". At a daylight-saving change, a
 * skipped or repeated local hour is as the browser resolves it.
 */
export function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${isoDay(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Items in groups by their local day, newest day first, as they came. */
export type DayGroup<T> = {
  /** The day, an ISO date. */
  readonly day: string;
  /** "Today", "Yesterday", or the date: "Nov 24, 2026". */
  readonly label: string;
  readonly items: readonly T[];
};

/**
 * Splits items, already in order, into runs by the local day of `at`. Each
 * run is labelled from `now`: Today, Yesterday, then the date.
 */
export function dayGroups<T>(
  items: readonly T[],
  at: (item: T) => string,
  now: Date,
): readonly DayGroup<T>[] {
  const today = isoDay(now);
  const yesterday = isoDay(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
  );
  const groups: { day: string; label: string; items: T[] }[] = [];
  for (const item of items) {
    const day = isoDay(new Date(at(item)));
    const last = groups.at(-1);
    if (last?.day === day) {
      last.items.push(item);
      continue;
    }
    const label =
      day === today
        ? 'Today'
        : day === yesterday
          ? 'Yesterday'
          : formatDay(day);
    groups.push({ day, label, items: [item] });
  }
  return groups;
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
