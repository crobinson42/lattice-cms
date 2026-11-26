import type { ReactNode } from 'react';

/** A titled part of a page, such as a company's contacts, with its action. */
export function Section({
  id,
  title,
  action,
  children,
}: {
  /** The section's anchor, and its heading's id. */
  readonly id: string;
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 id={`${id}-heading`} className="text-lg font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
