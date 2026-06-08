// Per-location DP constraints widget (Stage 8 Cinematography).
//
// Persistent rules the DP regen honors on EVERY shot in a given
// location. Two free-text areas per location:
//   - Lighting constraints (e.g. "No visible window as light source")
//   - Framing rules (e.g. "Closet interior + blood are out of frame; if
//     closet door falls in far background, unreadable dark shape only")
//
// Saved via `approveDeliverable` at canon paths
// `locationBibles.<key>.dpLightingConstraints` and `.dpFramingRules`.
// The DP regen reader (`loadShotContextForRegen`) surfaces these on
// every per-shot DP brief regeneration so the AI honors them.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Check, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";

interface Props {
  scriptId: string;
  onChange: () => void;
}

export function DPLocationConstraintsPanel({ scriptId, onChange }: Props) {
  const q = useQuery({
    queryKey: ["dp-location-constraints", scriptId],
    queryFn: () => api.getDPLocationConstraints(scriptId),
  });

  if (q.isLoading) {
    return (
      <div className="rounded border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-bone-400 mb-3">
        <Loader2 size={10} className="inline animate-spin mr-1" /> Loading
        location constraints…
      </div>
    );
  }
  if (q.error) return null;
  const locations = q.data?.locations ?? [];
  if (locations.length === 0) return null;

  return (
    <div className="mb-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-bone-400">
        Location-level DP constraints — applied to every shot in this location
      </div>
      {locations.map((loc) => (
        <LocationRow
          key={loc.key}
          scriptId={scriptId}
          locationKey={loc.key}
          name={loc.name}
          initialLighting={loc.lightingConstraints}
          initialFraming={loc.framingRules}
          onSaved={() => {
            q.refetch();
            onChange();
          }}
        />
      ))}
    </div>
  );
}

function LocationRow({
  scriptId,
  locationKey,
  name,
  initialLighting,
  initialFraming,
  onSaved,
}: {
  scriptId: string;
  locationKey: string;
  name: string;
  initialLighting: string;
  initialFraming: string;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [lighting, setLighting] = useState(initialLighting);
  const [framing, setFraming] = useState(initialFraming);
  // If the source data refreshes (e.g. after another widget saves),
  // re-seed the local state with the new server values.
  useEffect(() => {
    setLighting(initialLighting);
    setFraming(initialFraming);
  }, [initialLighting, initialFraming]);

  const save = useMutation({
    mutationFn: () =>
      api.saveDPLocationConstraints(scriptId, {
        locationKey,
        lightingConstraints: lighting,
        framingRules: framing,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow"] });
      qc.invalidateQueries({ queryKey: ["dp-location-constraints", scriptId] });
      onSaved();
    },
  });

  const dirty =
    lighting !== initialLighting || framing !== initialFraming;

  return (
    <div className="rounded border border-white/8 bg-white/[0.03] p-2.5">
      <div className="text-xs text-bone-100 mb-1.5 flex items-center gap-2">
        <span className="font-medium">{name}</span>
        {dirty && (
          <span className="text-[10px] uppercase tracking-wide rounded-full bg-amber-900/40 text-amber-200 ring-1 ring-amber-700/40 px-1.5 py-0.5">
            Unsaved
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-bone-500 mb-0.5">
            Lighting constraints (one rule per line)
          </div>
          <textarea
            value={lighting}
            onChange={(e) => setLighting(e.target.value)}
            rows={2}
            placeholder={`e.g. No visible window as light source. If separation needed, describe as minimal ambient shadow detail, not an identifiable window source.`}
            className="w-full rounded border border-white/10 bg-white/[0.04] text-bone-100 placeholder:text-bone-500 px-2 py-1 text-xs"
          />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-bone-500 mb-0.5">
            Framing / Out-of-frame rules (one rule per line)
          </div>
          <textarea
            value={framing}
            onChange={(e) => setFraming(e.target.value)}
            rows={2}
            placeholder={`e.g. Closet interior and blood are out of frame; if the closet door falls in the far background, it remains an unreadable dark shape with no detail.`}
            className="w-full rounded border border-white/10 bg-white/[0.04] text-bone-100 placeholder:text-bone-500 px-2 py-1 text-xs"
          />
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
        >
          {save.isPending ? (
            <Loader2 size={10} className="animate-spin mr-1" />
          ) : (
            <Check size={10} className="mr-1" />
          )}
          Save constraints
        </Button>
        {save.isSuccess && !save.isPending && !dirty && (
          <span className="text-[10px] text-emerald-300">
            Saved. Regenerate any shot's DP brief to apply.
          </span>
        )}
        {save.error && (
          <span className="text-[10px] text-red-300 inline-flex items-center gap-1">
            <AlertCircle size={10} /> {(save.error as Error).message}
          </span>
        )}
      </div>
    </div>
  );
}
