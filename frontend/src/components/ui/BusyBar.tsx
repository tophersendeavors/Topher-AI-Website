import { Loader2 } from "lucide-react";

export function BusyBar({ label, subtext }: { label: string; subtext?: string }) {
  return (
    <div className="overflow-hidden rounded border border-ember-700/40 bg-ember-950/30">
      <div className="flex items-center gap-3 p-3">
        <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin text-ember-200" />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-ember-100">{label}</div>
          {subtext && (
            <div className="mt-0.5 text-xs text-ember-200/70">{subtext}</div>
          )}
        </div>
      </div>
      <div className="h-1 w-full overflow-hidden bg-ember-950/60">
        <div className="h-full w-1/3 animate-pulse-soft rounded-r-full bg-gradient-to-r from-transparent via-ember-400 to-ember-300" />
      </div>
    </div>
  );
}
