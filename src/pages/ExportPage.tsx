import { useMemo } from "react";
import { Link } from "react-router-dom";
import DesignThumb from "@/components/DesignThumb";
import { exportManifest, exportPng, exportSvg } from "@/lib/exporter";
import { isPrintReady, printCheckScore } from "@/lib/printChecker";
import type { StudioApi } from "@/hooks/useDesignStudio";

export default function ExportPage({ studio }: { studio: StudioApi }) {
  const queue = useMemo(
    () =>
      studio.designs.filter(
        (d) => d.approved || d.readyForNinjaTransfers || d.status === "saved",
      ),
    [studio.designs],
  );

  return (
    <div className="space-y-8">
      <header>
        <div className="label">Print-ready file export</div>
        <h1 className="display-title text-4xl text-ash-bone mt-2 distress">
          Export
        </h1>
        <p className="text-ash-gray max-w-2xl mt-2">
          Each export is a transparent PNG at <strong>4500 × 5400px</strong> (≈
          15″ × 18″ at 300dpi) plus a clean SVG. Drop the PNG straight into
          Ninja Transfers' DTF order form.
        </p>
      </header>

      {queue.length === 0 ? (
        <div className="card p-10 text-center text-ash-gray">
          Nothing approved yet. Approve designs from the daily page first.
        </div>
      ) : (
        <div className="space-y-3">
          {queue.map((d) => {
            const ready = isPrintReady(d.printCheck);
            return (
              <div
                key={d.id}
                className="card p-4 flex items-center gap-5"
              >
                <Link to={`/design/${d.id}`} className="block w-24 shrink-0">
                  <DesignThumb design={d} size="sm" />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-3">
                    <h3 className="display-title text-lg text-ash-bone truncate">
                      {d.title}
                    </h3>
                    <span className="label">{d.garmentType}</span>
                    <span className="label">
                      {d.printSize.widthInches}″ × {d.printSize.heightInches}″
                    </span>
                  </div>
                  <p className="text-xs text-ash-gray mt-1 line-clamp-1">
                    {d.visualDirection}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-[10px] uppercase tracking-[0.22em]">
                    <span className={ready ? "text-ash-bone" : "text-ash-rust"}>
                      {printCheckScore(d.printCheck)}% ready
                    </span>
                    {d.readyForNinjaTransfers && (
                      <span className="chip">Ninja ✓</span>
                    )}
                    {d.stage === "exported" && (
                      <span className="chip">exported</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2 shrink-0">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={async () => {
                      await exportPng(d);
                      studio.updateDesign(d.id, { stage: "exported" });
                    }}
                  >
                    PNG
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      exportSvg(d);
                      studio.updateDesign(d.id, { stage: "exported" });
                    }}
                  >
                    SVG
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => exportManifest(d)}
                  >
                    JSON
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
