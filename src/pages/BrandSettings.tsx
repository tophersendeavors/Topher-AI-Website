import { useEffect, useState } from "react";
import type { StudioApi } from "@/hooks/useDesignStudio";
import {
  type BrandSettings,
  type GarmentType,
  GARMENT_TYPES,
} from "@/types";

export default function BrandSettingsPage({ studio }: { studio: StudioApi }) {
  const [draft, setDraft] = useState<BrandSettings>(studio.brand);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => setDraft(studio.brand), [studio.brand]);

  const togglePreferred = (g: GarmentType) => {
    setDraft((d) => ({
      ...d,
      preferredGarments: d.preferredGarments.includes(g)
        ? d.preferredGarments.filter((x) => x !== g)
        : [...d.preferredGarments, g],
    }));
  };

  return (
    <div className="space-y-8">
      <header>
        <div className="label">Brand voice · palette · guardrails</div>
        <h1 className="display-title text-4xl text-ash-bone mt-2 distress">
          Brand Settings
        </h1>
      </header>

      <form
        className="space-y-6 max-w-3xl"
        onSubmit={async (e) => {
          e.preventDefault();
          await studio.updateBrand(draft);
          setSavedAt(new Date().toLocaleTimeString());
        }}
      >
        <Field label="Brand name">
          <input
            className="input"
            value={draft.brandName}
            onChange={(e) => setDraft({ ...draft, brandName: e.target.value })}
          />
        </Field>

        <Field label="Voice / tone">
          <textarea
            className="input min-h-[110px]"
            value={draft.voice}
            onChange={(e) => setDraft({ ...draft, voice: e.target.value })}
          />
        </Field>

        <Field label="Signature prompt suffix">
          <textarea
            className="input min-h-[90px] font-mono text-[11px]"
            value={draft.signaturePromptSuffix}
            onChange={(e) =>
              setDraft({ ...draft, signaturePromptSuffix: e.target.value })
            }
          />
        </Field>

        <Field label="Color palette">
          <div className="flex flex-wrap gap-2">
            {draft.palette.map((c, i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  type="color"
                  value={c}
                  className="h-9 w-12 bg-ash-ink border border-white/10 cursor-pointer"
                  onChange={(e) => {
                    const next = [...draft.palette];
                    next[i] = e.target.value;
                    setDraft({ ...draft, palette: next });
                  }}
                />
                <button
                  type="button"
                  className="text-ash-gray hover:text-ash-rust text-xs"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      palette: draft.palette.filter((_, j) => j !== i),
                    })
                  }
                  aria-label="Remove color"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn"
              onClick={() =>
                setDraft({ ...draft, palette: [...draft.palette, "#000000"] })
              }
            >
              + add color
            </button>
          </div>
        </Field>

        <Field label="Preferred garments">
          <div className="flex flex-wrap gap-2">
            {GARMENT_TYPES.map((g) => {
              const active = draft.preferredGarments.includes(g);
              return (
                <button
                  type="button"
                  key={g}
                  className={`btn ${active ? "border-ash-bone text-ash-bone" : ""}`}
                  onClick={() => togglePreferred(g)}
                >
                  {g}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Forbidden terms (one per line)">
          <textarea
            className="input min-h-[120px] font-mono text-xs"
            value={draft.forbiddenTerms.join("\n")}
            onChange={(e) =>
              setDraft({
                ...draft,
                forbiddenTerms: e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
          <p className="text-[11px] text-ash-gray mt-1">
            Any design whose title or prompt matches one of these terms will
            fail the print-readiness check (used to block trademarked terms and
            competitor names).
          </p>
        </Field>

        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary">Save settings</button>
          {savedAt && (
            <span className="label text-ash-bone">Saved at {savedAt}</span>
          )}
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="label mb-2">{label}</div>
      {children}
    </div>
  );
}
