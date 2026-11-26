import { type ReactNode, useEffect, useRef } from 'react';
import { type Crumb, useBreadcrumb } from './shell.js';

/**
 * A page's title as its h1, with a line under it and the page's actions.
 * It puts the page in the top bar's breadcrumb, after `parents`. Its
 * heading takes focus when the page opens, so a screen reader announces the
 * new page and the keyboard starts from it.
 */
export function PageHeader({
  title,
  parents = noParents,
  icon,
  description,
  actions,
}: {
  readonly title: string;
  /** The pages above this one, for the breadcrumb. Keep it a constant. */
  readonly parents?: readonly Crumb[];
  readonly icon?: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  useBreadcrumb(parents, title);
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {icon === undefined ? null : (
          <div className="mt-1 text-muted-foreground [&_svg]:size-6">
            {icon}
          </div>
        )}
        <div>
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-2xl font-semibold outline-none"
          >
            {title}
          </h1>
          {description === undefined ? null : (
            <div className="text-sm text-muted-foreground">{description}</div>
          )}
        </div>
      </div>
      {actions === undefined ? null : (
        <div className="flex items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

const noParents: readonly Crumb[] = [];
