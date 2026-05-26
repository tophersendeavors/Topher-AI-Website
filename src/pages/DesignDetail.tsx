import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import DesignThumb from "@/components/DesignThumb";
import PrintReadinessChecklist from "@/components/PrintReadinessChecklist";
import StageRail from "@/components/StageRail";
import { placementLabel } from "@/lib/designGenerator";
import { exportManifest, exportPng, exportSvg } from "@/lib/exporter";
import type { StudioApi } from "@/hooks/useDesignStudio";
import { GARMENT_TYPES, type GarmentType } from "@/types";

export default function DesignDetail({ studio }: { studio: StudioApi }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const design = useMemo(
    () => studio.designs.find((d) => d.id === id),
    [studio.designs, id],
  );

  const [promptDraft, setPromptDraft] = useState(design?.prompt ?? "");
  const [paletteDraft, setPaletteDraft] = useState(
    (design?.colorPalette ?? []).join(", "),
  );
  const [busy, setBusy] = useState(false);

  if (!design) {
    return (
      <div className="card p-10 text-center text-ash-gray">
        Design not found.
        <Link to="/daily" className="btn ml-4">Back to daily</Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-6">
        <div>
          <div className="label">{design.generatedFor} · seed {design.artwork.seed}</div>
          <h1 className="display-title text-4xl text-ash-bone distress mt-1">{design.title}</h1>
          <p className="text-ash-gray max-w-xl mt-2">{design.visualDirection}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn"
            onClick={async () => {
              setBusy(true);
              const next = await studio.regenerate(design.id);
              setPromptDraft(next.prompt);
              setPaletteDraft(next.colorPalette.join(", "));
              setBusy(false);
            }}
            disabled={busy}
          >
            Regenerate
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={async () => {
              await studio.removeDesign(design.id);
              navigate("/daily");
            }}
          >
            Delete
          </button>
        </div>
      </header>

      <StageRail current={design.stage} />

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-6">
        <div className="card p-6">
          <DesignThumb design={design} size="lg" />
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <Info label="Garment">{design.garmentType}</Info>
            <Info label="Placement">{placementLabel(design.placement)}</Info>
            <Info label="Print size">
              {design.printSize.widthInches}″ × {design.printSize.heightInches}″
            </Info>
            <Info label="Tags">{design.trendTags.join(" · ")}</Info>
          </div>
          <div className="mt-4">
            <div className="label mb-1">Color palette</div>
            <div className="flex gap-2">
              {design.colorPalette.map((c) => (
                <span
                  key={c}
                  className="w-7 h-7 border border-white/10"
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
          </div>
          <div className="mt-4">
            <div className="label mb-1">Heat-transfer notes</div>
            <p className="text-xs text-ash-bone/90 leading-relaxed">{design.heatTransferNotes}</p>
          </div>
        </div>

        <div className="space-y-6">
          <PrintReadinessChecklist check={design.printCheck} />

          <div className="card p-5 space-y-4">
            <h3 className="display-title text-sm tracking-[0.22em] text-ash-bone">
              Controls
            </h3>

            <div>
              <label className="label" htmlFor="garment">Garment type</label>
              <select
                id="garment"
                className="input mt-1"
                value={design.garmentType}
                onChange={(e) =>
                  studio.setGarmentType(design.id, e.target.value as GarmentType)
                }
              >
                {GARMENT_TYPES.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="prompt">Prompt</label>
              <textarea
                id="prompt"
                className="input mt-1 min-h-[120px] font-mono text-[11px] leading-relaxed"
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
              />
              <button
                type="button"
                className="btn mt-2"
                onClick={() => studio.updateDesign(design.id, { prompt: promptDraft })}
              >
                Save prompt
              </button>
            </div>

            <div>
              <label className="label" htmlFor="palette">Color palette (comma hex)</label>
              <input
                id="palette"
                className="input mt-1 font-mono text-xs"
                value={paletteDraft}
                onChange={(e) => setPaletteDraft(e.target.value)}
              />
              <button
                type="button"
                className="btn mt-2"
                onClick={() =>
                  studio.updateDesign(design.id, {
                    colorPalette: paletteDraft
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              >
                Apply palette
              </button>
            </div>

            <div>
              <label className="label" htmlFor="notes">
                Notes for placement / sizing
              </label>
              <textarea
                id="notes"
                className="input mt-1 min-h-[80px]"
                value={design.notes}
                onChange={(e) =>
                  studio.updateDesign(design.id, { notes: e.target.value })
                }
              />
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                className="btn"
                onClick={() => studio.updateDesign(design.id, { status: "saved" })}
              >
                Save to library
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  studio.updateDesign(design.id, {
                    approved: true,
                    status: "approved",
                    stage: "approved",
                  })
                }
              >
                Approve
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() =>
                  studio.updateDesign(design.id, {
                    approved: false,
                    status: "rejected",
                  })
                }
              >
                Reject
              </button>
              <button
                type="button"
                className={design.readyForNinjaTransfers ? "btn-primary" : "btn"}
                onClick={() =>
                  studio.updateDesign(design.id, {
                    readyForNinjaTransfers: !design.readyForNinjaTransfers,
                  })
                }
              >
                {design.readyForNinjaTransfers ? "✓ Ninja-ready" : "Mark Ninja-ready"}
              </button>
            </div>
          </div>

          <div className="card p-5 space-y-3">
            <h3 className="display-title text-sm tracking-[0.22em] text-ash-bone">
              Export
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary"
                onClick={async () => {
                  await exportPng(design);
                  studio.updateDesign(design.id, { stage: "exported" });
                }}
              >
                Download PNG (4500px)
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  exportSvg(design);
                  studio.updateDesign(design.id, { stage: "exported" });
                }}
              >
                Download SVG
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => exportManifest(design)}
              >
                Download manifest (JSON)
              </button>
            </div>
            <p className="text-[11px] text-ash-gray leading-relaxed">
              PNG exports rasterize the SVG into a 4500 × 5400 transparent
              canvas. SVG keeps clean vector paths; type is rendered with system
              fallbacks (use a font-converted-to-outlines export tool if your
              vendor needs strict outlines).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-0.5 text-ash-bone">{children}</div>
    </div>
  );
}
