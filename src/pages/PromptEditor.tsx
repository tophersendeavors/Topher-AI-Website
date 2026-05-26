import { useState } from "react";
import type { StudioApi } from "@/hooks/useDesignStudio";
import { DEFAULT_PROMPT_TEMPLATE } from "@/lib/store";

const PLACEHOLDERS = [
  { key: "{{scene}}", desc: "Trend scene (e.g. 'gothic minimalism')" },
  { key: "{{mood}}", desc: "Trend mood (e.g. 'monastic restraint')" },
  { key: "{{motif}}", desc: "Anchor motif from the trend signal" },
  { key: "{{title}}", desc: "Generated headline / slogan" },
  { key: "{{garment}}", desc: "Target garment type" },
];

export default function PromptEditor({ studio }: { studio: StudioApi }) {
  const [draft, setDraft] = useState(studio.promptTemplate || DEFAULT_PROMPT_TEMPLATE);

  return (
    <div className="space-y-8">
      <header>
        <div className="label">Master template for daily generation</div>
        <h1 className="display-title text-4xl text-ash-bone mt-2 distress">
          Prompt Editor
        </h1>
        <p className="text-ash-gray max-w-2xl mt-2">
          This template is fed into the image-generation API (when configured)
          and steers the procedural fallback's headline composition.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
        <div className="card p-5">
          <label className="label" htmlFor="tpl">Template</label>
          <textarea
            id="tpl"
            className="input mt-2 font-mono text-xs leading-relaxed min-h-[420px]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              type="button"
              className="btn-primary"
              onClick={() => studio.updatePromptTemplate(draft)}
            >
              Save template
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setDraft(DEFAULT_PROMPT_TEMPLATE)}
            >
              Reset to default
            </button>
          </div>
        </div>

        <aside className="card p-5">
          <h3 className="display-title text-sm tracking-[0.22em] text-ash-bone mb-3">
            Placeholders
          </h3>
          <ul className="space-y-3 text-xs">
            {PLACEHOLDERS.map((p) => (
              <li key={p.key}>
                <code className="font-mono text-ash-bone">{p.key}</code>
                <p className="text-ash-gray mt-0.5">{p.desc}</p>
              </li>
            ))}
          </ul>
          <h3 className="display-title text-sm tracking-[0.22em] text-ash-bone mt-6 mb-3">
            Guardrails
          </h3>
          <p className="text-xs text-ash-gray leading-relaxed">
            Forbidden terms from Brand Settings are appended as negative
            constraints. Trademarked brand names will cause the design to fail
            the print-readiness check automatically.
          </p>
        </aside>
      </div>
    </div>
  );
}
