import { Link } from "react-router-dom";
import DesignThumb from "@/components/DesignThumb";
import { printCheckScore } from "@/lib/printChecker";
import type { Design } from "@/types";

export default function DesignCard({ design }: { design: Design }) {
  const score = printCheckScore(design.printCheck);
  return (
    <Link
      to={`/design/${design.id}`}
      className="card group flex flex-col hover:border-white/20 transition-colors"
    >
      <DesignThumb design={design} />
      <div className="p-4 flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="display-title text-lg text-ash-bone truncate distress">
            {design.title}
          </h3>
          <span className="label shrink-0">{score}%</span>
        </div>
        <p className="text-xs text-ash-gray line-clamp-2">{design.visualDirection}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {design.trendTags.slice(0, 3).map((t) => (
            <span key={t} className="chip">{t}</span>
          ))}
        </div>
        <div className="flex items-center justify-between mt-3 text-[10px] uppercase tracking-[0.22em] text-ash-gray">
          <span>{design.placement.replace(/-/g, " ")}</span>
          <span>
            {design.printSize.widthInches}″ × {design.printSize.heightInches}″
          </span>
        </div>
      </div>
    </Link>
  );
}
