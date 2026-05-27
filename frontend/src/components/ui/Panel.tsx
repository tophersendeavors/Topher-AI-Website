import clsx from "clsx";
import type { ReactNode } from "react";

export function Panel({
  title,
  eyebrow,
  actions,
  children,
  className,
  strong,
}: {
  title?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  strong?: boolean;
}) {
  return (
    <section className={clsx(strong ? "panel-strong" : "panel", "p-5", className)}>
      {(title || eyebrow || actions) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {eyebrow && <div className="label-eyebrow mb-1">{eyebrow}</div>}
            {title && (
              <h2 className="font-serif text-lg leading-tight text-bone-50">
                {title}
              </h2>
            )}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
