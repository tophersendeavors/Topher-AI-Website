import clsx from "clsx";
import { Check } from "lucide-react";

/**
 * Approval ribbon — the green-stamped pill the mockup shows in the
 * bottom-right of an approved panel. Drop it into a `Panel footer={}`
 * slot or anywhere you need a clean "Approved · timestamp" indicator.
 */
export function ApprovalBadge({
  approvedAt,
  label = "Approved",
  className,
}: {
  approvedAt?: string | null;
  label?: string;
  className?: string;
}) {
  const ts = approvedAt ? new Date(approvedAt) : null;
  return (
    <div className={clsx("flex items-center gap-3", className)}>
      <span className="os-approve-stamp">
        <Check className="h-3.5 w-3.5" />
        {label}
      </span>
      {ts && (
        <span className="os-approve-stamp-time">
          {ts.toLocaleString(undefined, {
            month: "numeric",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      )}
    </div>
  );
}
