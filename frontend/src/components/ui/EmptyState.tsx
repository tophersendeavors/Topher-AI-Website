import type { ComponentType, ReactNode, SVGProps } from "react";

export function EmptyState({
  title,
  description,
  action,
  Icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  Icon?: ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-8 py-14 text-center">
      {Icon && (
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-white/[0.03] text-ember-400 ring-1 ring-white/10">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <h3 className="font-serif text-lg text-bone-50">{title}</h3>
      {description && (
        <p className="mt-1 max-w-md text-sm text-bone-300">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
