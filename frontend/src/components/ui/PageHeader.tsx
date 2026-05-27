import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 px-8 pt-8">
      <div>
        {eyebrow && <div className="label-eyebrow mb-2">{eyebrow}</div>}
        <h1 className="font-serif text-3xl leading-tight text-bone-50">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm text-bone-300">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
