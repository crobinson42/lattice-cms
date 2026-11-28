import { formatDateTime, formatRelative } from './format.js';
import { useNow } from './now.js';

/**
 * A date-time relative to now, "3 days ago", kept current by the minute,
 * with the exact time in its title.
 */
export function RelativeTime({
  iso,
  className,
}: {
  readonly iso: string;
  readonly className?: string;
}) {
  const now = useNow(60_000);
  return (
    <time
      dateTime={iso}
      title={formatDateTime(iso)}
      {...(className === undefined ? {} : { className })}
    >
      {formatRelative(iso, now)}
    </time>
  );
}
