import { getPrintCheckLabel, printCheckScore } from "@/lib/printChecker";
import type { PrintReadinessCheck } from "@/types";

export default function PrintReadinessChecklist({
  check,
}: {
  check: PrintReadinessCheck;
}) {
  const score = printCheckScore(check);
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="display-title text-sm tracking-[0.22em] text-ash-bone">
          Print Readiness
        </h3>
        <span className={`label ${score === 100 ? "text-ash-bone" : "text-ash-rust"}`}>
          {score}% ready
        </span>
      </div>
      <ul className="space-y-2">
        {(Object.entries(check) as [keyof PrintReadinessCheck, boolean][]).map(
          ([key, ok]) => (
            <li
              key={key}
              className="flex items-center gap-3 text-xs text-ash-bone/90"
            >
              <span
                className={`w-3 h-3 border ${ok ? "bg-ash-bone border-ash-bone" : "border-ash-gray/40"}`}
                aria-hidden
              />
              <span className={ok ? "" : "text-ash-gray"}>
                {getPrintCheckLabel(key)}
              </span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
