import { DESIGN_STAGES, type DesignStage } from "@/types";

export default function StageRail({ current }: { current: DesignStage }) {
  const idx = DESIGN_STAGES.indexOf(current);
  return (
    <ol className="flex items-center gap-1 text-[10px] uppercase tracking-[0.22em]">
      {DESIGN_STAGES.map((stage, i) => {
        const reached = i <= idx;
        return (
          <li key={stage} className="flex items-center gap-1">
            <span
              className={`px-2 py-1 border ${
                reached
                  ? "border-ash-bone text-ash-bone bg-white/5"
                  : "border-white/10 text-ash-gray"
              }`}
            >
              {stage}
            </span>
            {i < DESIGN_STAGES.length - 1 && (
              <span
                className={`h-px w-4 ${reached && i < idx ? "bg-ash-bone" : "bg-white/10"}`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
