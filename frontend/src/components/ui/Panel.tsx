import clsx from "clsx";
import type { ReactNode } from "react";

/**
 * Premium glass panel. The whole app uses `<Panel>` for its content
 * sections, so this is the single highest-leverage component for the
 * studio-OS look. Three visual tiers:
 *   • default  — translucent graphite glass (most pages)
 *   • strong   — heavier glass + stronger shadow for hero panels
 *   • elevated — extra padding + ember-tinted top gradient, matches the
 *                mockup's right-side content panel
 */
export function Panel({
  title,
  eyebrow,
  emberEyebrow = false,
  actions,
  footer,
  children,
  className,
  strong,
  elevated,
}: {
  title?: ReactNode;
  eyebrow?: string;
  /** Render the eyebrow with the ember "diamond + ORANGE" treatment. */
  emberEyebrow?: boolean;
  actions?: ReactNode;
  /** Optional footer slot — used by the mockup's bottom approval ribbon. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  strong?: boolean;
  elevated?: boolean;
}) {
  return (
    <section
      className={clsx(
        elevated
          ? "os-content-panel"
          : strong
            ? "panel-strong p-6"
            : "panel p-5",
        className
      )}
    >
      {(title || eyebrow || actions) && (
        <header
          className={clsx(
            "flex items-start justify-between gap-4",
            elevated ? "mb-5" : "mb-4"
          )}
        >
          <div className="min-w-0">
            {eyebrow && (
              <div
                className={clsx(
                  emberEyebrow ? "os-eyebrow-ember" : "label-eyebrow",
                  "mb-2"
                )}
              >
                {eyebrow}
              </div>
            )}
            {title && (
              <h2
                className={clsx(
                  elevated
                    ? "os-content-panel-h1"
                    : "font-serif text-lg leading-tight text-bone-50"
                )}
              >
                {title}
              </h2>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 shrink-0">{actions}</div>
          )}
        </header>
      )}
      {children}
      {footer && (
        <div className="mt-6 flex items-center justify-between gap-4 border-t border-white/[0.06] pt-4">
          {footer}
        </div>
      )}
    </section>
  );
}
