import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import type { Character } from "@toburt/shared";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export function CharacterBiblePage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["characters", projectId],
    queryFn: () => api.listCharacters(projectId),
  });

  const [selected, setSelected] = useState<Character | null>(null);
  const [showNew, setShowNew] = useState(false);

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Character Bible"
        title="Cast & voices"
        description="Bibles, arcs, wants/needs/flaw, voice tells. Approved entries become canon and the Dialogue agent scores against them."
        actions={
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> New character
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-6 px-8 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Panel eyebrow="Roster" title="Characters">
          {list.isLoading ? (
            <div className="h-24 animate-pulse-soft rounded-lg bg-white/[0.03]" />
          ) : (list.data ?? []).length === 0 ? (
            <EmptyState
              Icon={Users}
              title="No characters yet"
              description="Create your protagonist to get started."
              action={
                <Button onClick={() => setShowNew(true)}>
                  <Plus className="h-4 w-4" /> Create
                </Button>
              }
            />
          ) : (
            <ul className="space-y-1.5">
              {list.data!.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setSelected(c)}
                    className={`flex w-full items-start gap-2 rounded-md border border-white/8 p-2.5 text-left transition-colors ${
                      selected?.id === c.id ? "bg-white/[0.06]" : "bg-white/[0.02] hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="grid h-8 w-8 place-items-center rounded-md bg-white/[0.04] text-xs font-semibold text-bone-100">
                      {c.name.slice(0, 1)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm text-bone-50">{c.name}</div>
                      <div className="truncate text-xs text-bone-400">
                        {c.archetype ?? "—"} • {c.role ?? "—"}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          eyebrow="Detail"
          title={selected?.name ?? "Select a character"}
        >
          {selected ? (
            <CharacterDetail character={selected} />
          ) : (
            <div className="rounded-lg border border-dashed border-white/10 p-8 text-center text-sm text-bone-400">
              Pick a character to view their bible.
            </div>
          )}
        </Panel>
      </div>

      {showNew && (
        <NewCharacterDialog
          projectId={projectId}
          onClose={() => setShowNew(false)}
          onCreated={(c) => {
            qc.invalidateQueries({ queryKey: ["characters", projectId] });
            setSelected(c);
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}

function CharacterDetail({ character }: { character: Character }) {
  const wound = useQuery({
    queryKey: ["wound", character.id],
    queryFn: () => api.getCharacterWound(character.id),
  });
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Field label="Archetype" value={character.archetype} />
      <Field label="Role" value={character.role} />
      <Field label="Want" value={character.wants} wide />
      <Field label="Need" value={character.needs} wide />
      <Field label="Flaw" value={character.flaw} wide />
      <Field label="Voice notes" value={character.voice_notes} wide pre />
      <Field label="Biography" value={character.biography} wide pre />
      {character.arc && (
        <div className="md:col-span-2">
          <div className="label-eyebrow mb-1">Arc</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {(["act1", "act2", "act3"] as const).map((k) => (
              <div
                key={k}
                className="rounded-md border border-white/8 bg-white/[0.02] p-3 text-sm text-bone-200"
              >
                <div className="label-eyebrow mb-1">{k.toUpperCase()}</div>
                {(character.arc as Record<string, string>)?.[k] ?? "—"}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="md:col-span-2">
        <div className="label-eyebrow mb-1 flex items-center gap-2">
          Core wound
          {wound.data && (
            <span className="chip">{wound.data.kind ?? "custom"}</span>
          )}
        </div>
        {!wound.data ? (
          <div className="rounded-md border border-dashed border-white/10 bg-white/[0.02] p-3 text-xs text-bone-400">
            No wound tracked yet. Invoke the <strong>Wound</strong> agent in the
            Writers Room with this character's name to generate one.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <Field label="Wound" value={wound.data.wound} />
            <Field label="Fear" value={wound.data.fear} />
            <Field label="Unmet need" value={wound.data.unmetNeed} />
            <Field label="Shame trigger" value={wound.data.shameTrigger} />
            <div className="md:col-span-2">
              <div className="label-eyebrow mb-1">Defenses</div>
              <div className="flex flex-wrap gap-1.5">
                {(wound.data.defenses ?? []).map((d: string) => (
                  <span key={d} className="chip">{d}</span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  wide,
  pre,
}: {
  label: string;
  value?: string | null;
  wide?: boolean;
  pre?: boolean;
}) {
  return (
    <div className={wide ? "md:col-span-2" : ""}>
      <div className="label-eyebrow mb-1">{label}</div>
      <div
        className={`rounded-md border border-white/8 bg-white/[0.02] p-3 text-sm text-bone-200 ${
          pre ? "whitespace-pre-wrap" : ""
        }`}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}

function NewCharacterDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (c: Character) => void;
}) {
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState("");
  const [role, setRole] = useState("protagonist");
  const m = useMutation({
    mutationFn: () =>
      api.createCharacter({
        projectId,
        name,
        archetype: archetype || undefined,
        role,
      }),
    onSuccess: onCreated,
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="panel-strong w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-serif text-xl">New character</h2>
        <div className="mt-4 space-y-3">
          <div>
            <label className="label-eyebrow mb-1 block">Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label-eyebrow mb-1 block">Archetype</label>
            <input className="input" value={archetype} onChange={(e) => setArchetype(e.target.value)} />
          </div>
          <div>
            <label className="label-eyebrow mb-1 block">Role</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="protagonist">Protagonist</option>
              <option value="antagonist">Antagonist</option>
              <option value="supporting">Supporting</option>
              <option value="ensemble">Ensemble</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => m.mutate()} disabled={!name || m.isPending}>Create</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
