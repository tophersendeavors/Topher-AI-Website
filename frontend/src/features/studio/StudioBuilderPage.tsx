import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Loader2, Sparkles, Check } from "lucide-react";
import {
  STUDIO_ATMOSPHERE_LABELS,
  STUDIO_LOCATION_LABELS,
  STUDIO_SCALE_LABELS,
  STUDIO_STYLE_LABELS,
  type StudioAtmosphere,
  type StudioConcept,
  type StudioConfigResponse,
  type StudioLocation,
  type StudioPreferences,
  type StudioScale,
  type StudioStyle,
} from "@toburt/shared";
import { api } from "@/lib/api";

const GOLD = "#d8b15a";
const gold = { color: GOLD };

const styles = Object.keys(STUDIO_STYLE_LABELS) as StudioStyle[];
const locations = Object.keys(STUDIO_LOCATION_LABELS) as StudioLocation[];
const atmospheres = Object.keys(STUDIO_ATMOSPHERE_LABELS) as StudioAtmosphere[];
const scales = Object.keys(STUDIO_SCALE_LABELS) as StudioScale[];

export function StudioBuilderPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["studio-config"], queryFn: () => api.getStudioConfig() });
  const seed = (r: StudioConfigResponse) => qc.setQueryData(["studio-config"], r);

  const config = q.data?.config ?? null;
  const [prefs, setPrefs] = useState<StudioPreferences>(
    () => config?.preferences ?? { style: null, location: null, atmosphere: [], scale: null }
  );

  const generate = useMutation({
    mutationFn: () => api.generateStudioConfig(prefs),
    onSuccess: seed,
  });
  const approve = useMutation({
    mutationFn: (conceptId: string) => api.approveStudioConfig(conceptId),
    onSuccess: (r) => {
      seed(r);
      nav("/studio");
    },
  });

  const concepts = config?.concepts ?? [];
  const toggleAtmo = (a: StudioAtmosphere) =>
    setPrefs((p) => ({
      ...p,
      atmosphere: p.atmosphere.includes(a) ? p.atmosphere.filter((x) => x !== a) : [...p.atmosphere, a],
    }));

  return (
    <div className="min-h-screen bg-[#08080a] px-8 py-8 text-bone-100">
      <Link to="/studio" className="inline-flex items-center gap-1 text-[12px] text-bone-400 hover:text-bone-100">
        <ChevronLeft className="h-4 w-4" /> Studio Lot
      </Link>

      <div className="mt-5 max-w-4xl">
        <div className="text-[11px] uppercase tracking-[0.3em]" style={gold}>Build your studio</div>
        <h1 className="mt-1 font-serif text-3xl text-bone-50">If you owned a movie studio, what would it feel like?</h1>
        <p className="mt-1 text-[13px] text-bone-400">
          Design it. We'll generate studios with a soul — pick the one that feels like home.
        </p>

        {/* Questionnaire */}
        <div className="mt-6 space-y-5">
          <ChipRow label="Style" options={styles} labels={STUDIO_STYLE_LABELS} value={prefs.style} onPick={(v) => setPrefs((p) => ({ ...p, style: v }))} />
          <ChipRow label="Location" options={locations} labels={STUDIO_LOCATION_LABELS} value={prefs.location} onPick={(v) => setPrefs((p) => ({ ...p, location: v }))} />
          <div>
            <div className="text-[10.5px] uppercase tracking-wide text-bone-500">Atmosphere</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {atmospheres.map((a) => (
                <Chip key={a} active={prefs.atmosphere.includes(a)} onClick={() => toggleAtmo(a)}>
                  {STUDIO_ATMOSPHERE_LABELS[a]}
                </Chip>
              ))}
            </div>
          </div>
          <ChipRow label="Scale" options={scales} labels={STUDIO_SCALE_LABELS} value={prefs.scale} onPick={(v) => setPrefs((p) => ({ ...p, scale: v }))} />
        </div>

        <button
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
          className="mt-6 inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-[14px] font-medium text-black disabled:opacity-50"
          style={{ background: GOLD }}
        >
          {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {concepts.length ? "Regenerate studios" : "Generate my studios"}
        </button>
        {generate.isError && <p className="mt-2 text-[12px] text-red-300">{(generate.error as Error).message}</p>}

        {/* Concepts */}
        {concepts.length > 0 && (
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {concepts.map((c) => (
              <ConceptCard
                key={c.id}
                concept={c}
                approved={config?.approvedConceptId === c.id}
                busy={approve.isPending}
                onApprove={() => approve.mutate(c.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChipRow<T extends string>({
  label,
  options,
  labels,
  value,
  onPick,
}: {
  label: string;
  options: T[];
  labels: Record<T, string>;
  value: T | null;
  onPick: (v: T) => void;
}) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-bone-500">{label}</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Chip key={o} active={value === o} onClick={() => onPick(o)}>
            {labels[o]}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border px-3 py-1 text-[12px] transition-colors"
      style={
        active
          ? { borderColor: GOLD, color: GOLD, background: "rgba(216,177,90,0.10)" }
          : { borderColor: "rgba(255,255,255,0.12)", color: "#bdb497" }
      }
    >
      {children}
    </button>
  );
}

function ConceptCard({
  concept,
  approved,
  busy,
  onApprove,
}: {
  concept: StudioConcept;
  approved: boolean;
  busy: boolean;
  onApprove: () => void;
}) {
  return (
    <div
      className="flex flex-col rounded-2xl border bg-gradient-to-b from-[#141008] to-[#0b0a08] p-5"
      style={{ borderColor: approved ? GOLD : "rgba(216,177,90,0.2)" }}
    >
      <div className="font-serif text-2xl text-bone-50">{concept.name}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-[0.18em]" style={gold}>{concept.tagline}</div>
      <p className="mt-3 flex-1 text-[12.5px] leading-relaxed text-bone-300">{concept.identity}</p>
      <button
        onClick={onApprove}
        disabled={busy || approved}
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg py-2 text-[13px] font-medium disabled:opacity-60"
        style={approved ? { border: `1px solid ${GOLD}`, color: GOLD } : { background: GOLD, color: "#000" }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : approved ? <Check className="h-4 w-4" /> : <Check className="h-4 w-4" />}
        {approved ? "Your studio" : "Make this my studio"}
      </button>
    </div>
  );
}
