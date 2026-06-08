import clsx from "clsx";
import { type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Field card — a single labeled glass tile with an icon prefix. Matches
 * the mockup's "What changed about the show / Audience promise / New
 * core principle" rows inside the Redevelopment Brief content panel.
 *
 * Pass either `children` (custom body) or just the label/help + your own
 * inline content. Use the `focused` flag to ember-tint the border when
 * a user is actively editing.
 */
export function FieldCard({
  icon: Icon,
  label,
  help,
  focused,
  children,
  className,
  actions,
}: {
  icon?: LucideIcon;
  label: ReactNode;
  help?: ReactNode;
  focused?: boolean;
  children?: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={clsx("os-field-card", focused && "is-focused", className)}>
      {Icon && (
        <div className="os-field-ic">
          <Icon className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="os-field-label">{label}</div>
            {help && <div className="os-field-help">{help}</div>}
          </div>
          {actions && (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
