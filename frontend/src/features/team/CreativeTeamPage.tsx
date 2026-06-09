// Creative Team & Role Assignment — Phase C.
//
// Lives at /projects/:projectId/team. Lists every role (core registry
// + auto-derived actor / voice rows) with assignment status, lets the
// writer assign each one as AI / AI-Creative / Live Person via a side
// drawer, and exposes a "mark roster approved" toggle.

import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Brain,
  Check,
  ChevronRight,
  Lightbulb,
  Loader2,
  Sparkles,
  Trash2,
  User,
  Users,
  Wand2,
  X,
} from "lucide-react";
import {
  CREATIVE_BRIEF_STYLES,
  CREATIVE_BRIEF_LABEL,
  HANDOFF_FORMATS,
  HANDOFF_LABEL,
  MODEL_TARGETS,
  MODEL_TARGET_LABEL,
  ROLE_CATEGORY_LABEL,
  ROLE_KINDS,
  ROLE_KIND_DESCRIPTION,
  ROLE_KIND_LABEL,
  type CreativeBriefStyle,
  type HandoffFormat,
  type ModelTarget,
  type RoleAssignment,
  type RoleAssignmentPatch,
  type RoleCategory,
  type RoleDefinition,
  type RoleKind,
  type RoleRecommendation,
  type RoleSlot,
  type TeamRosterResponse,
} from "@toburt/shared";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { WayfinderPanel } from "@/components/ui/WayfinderPanel";

type FilterKind = "all" | "unassigned" | RoleKind;

export function CreativeTeamPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  const qc = useQueryClient();

  const rosterQ = useQuery({
    queryKey: ["team-roster", projectId],
    queryFn: () => api.getTeamRoster(projectId),
  });

  const approve = useMutation({
    mutationFn: (approved: boolean) => api.approveTeamRoster(projectId, approved),
    onSuccess: (data) => qc.setQueryData(["team-roster", projectId], data),
  });

  const [editing, setEditing] = useState<RoleSlot | null>(null);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ assigned: number; skipped: number } | null>(null);

  const applyRecsM = useMutation({
    mutationFn: (opts: { overwriteExisting: boolean; includeOptional: boolean }) =>
      api.applyTeamRecommendations(projectId, opts),
    onSuccess: (data) => {
      if (data.roster) qc.setQueryData(["team-roster", projectId], data.roster);
      setBulkResult({ assigned: data.assigned, skipped: data.skipped });
      setBulkOpen(false);
    },
  });

  if (rosterQ.isLoading) return <div className="p-8 text-bone-300">Loading creative team…</div>;
  if (rosterQ.isError || !rosterQ.data)
    return (
      <div className="p-8 text-red-300">
        Could not load team. {(rosterQ.error as Error | undefined)?.message ?? ""}
      </div>
    );

  const roster: TeamRosterResponse = rosterQ.data;
  const summary = roster.summary;
  const slots = filterSlots(roster.slots, filter);
  const groups = groupByCategory(slots);

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        eyebrow="Studio Phase · Team"
        title={`${roster.projectTitle ?? "Project"} — Creative Team`}
        description={
          summary.rosterApprovedAt
            ? `Roster approved ${new Date(summary.rosterApprovedAt).toLocaleString()}. ${summary.assignedRoles} / ${summary.totalRoles} roles assigned.`
            : `${summary.assignedRoles} / ${summary.totalRoles} roles assigned · ${summary.assignedRequiredRoles} / ${summary.requiredRoles} required.`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/projects/${projectId}`}>
              <Button variant="outline">Studio Timeline</Button>
            </Link>
            <Button
              variant="outline"
              onClick={() => setBulkOpen(true)}
              disabled={applyRecsM.isPending}
              title="Auto-assign recommended defaults for every required role still unassigned"
            >
              <Wand2 className="h-4 w-4" />
              Apply recommended setup
            </Button>
            {summary.rosterApprovedAt ? (
              <Button
                variant="outline"
                onClick={() => approve.mutate(false)}
                disabled={approve.isPending}
              >
                Unmark approved
              </Button>
            ) : (
              <Button
                onClick={() => approve.mutate(true)}
                disabled={approve.isPending || summary.assignedRoles === 0}
              >
                {approve.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Mark roster approved
              </Button>
            )}
          </div>
        }
      />

      <div className="px-8 space-y-6">
        <WayfinderPanel projectId={projectId} scope="production" />

        <SummaryStrip roster={roster} />
        <FilterBar filter={filter} setFilter={setFilter} byKind={summary.byKind} />

        {groups.length === 0 ? (
          <Panel>
            <div className="text-sm text-bone-400">No roles match your filter.</div>
          </Panel>
        ) : (
          groups.map((g) => (
            <Panel
              key={g.category}
              eyebrow={ROLE_CATEGORY_LABEL[g.category]}
              title={`${g.slots.length} role${g.slots.length === 1 ? "" : "s"}`}
            >
              <ul className="space-y-2">
                {g.slots.map((s) => (
                  <RoleRow
                    key={s.definition.key}
                    slot={s}
                    onEdit={() => setEditing(s)}
                  />
                ))}
              </ul>
            </Panel>
          ))
        )}
      </div>

      {editing && (
        <AssignmentDrawer
          projectId={projectId}
          slot={editing}
          onClose={() => setEditing(null)}
          onSaved={(data) => {
            qc.setQueryData(["team-roster", projectId], data);
            setEditing(null);
          }}
        />
      )}

      {bulkOpen && (
        <BulkApplyModal
          pending={applyRecsM.isPending}
          summary={summary}
          onClose={() => setBulkOpen(false)}
          onApply={(opts) => applyRecsM.mutate(opts)}
        />
      )}

      {bulkResult && (
        <BulkResultToast
          result={bulkResult}
          onClose={() => setBulkResult(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filterSlots(slots: RoleSlot[], filter: FilterKind): RoleSlot[] {
  if (filter === "all") return slots;
  if (filter === "unassigned") return slots.filter((s) => s.assignment === null);
  return slots.filter((s) => s.assignment?.kind === filter);
}

const CATEGORY_ORDER: RoleCategory[] = [
  "leadership",
  "writing",
  "directing",
  "camera",
  "production_design",
  "sound_music",
  "post",
  "talent",
  "ops",
];

function groupByCategory(
  slots: RoleSlot[]
): Array<{ category: RoleCategory; slots: RoleSlot[] }> {
  const byCat = new Map<RoleCategory, RoleSlot[]>();
  for (const s of slots) {
    const list = byCat.get(s.definition.category) ?? [];
    list.push(s);
    byCat.set(s.definition.category, list);
  }
  const out: Array<{ category: RoleCategory; slots: RoleSlot[] }> = [];
  for (const cat of CATEGORY_ORDER) {
    const list = byCat.get(cat);
    if (list && list.length > 0) {
      // Required first, then by label.
      list.sort((a, b) => {
        if (a.definition.required !== b.definition.required)
          return a.definition.required ? -1 : 1;
        return a.definition.label.localeCompare(b.definition.label);
      });
      out.push({ category: cat, slots: list });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Summary strip
// ---------------------------------------------------------------------------

function SummaryStrip({ roster }: { roster: TeamRosterResponse }) {
  const s = roster.summary;
  const tiles: Array<{ label: string; value: string; tone?: "ok" | "warn" }> = [
    { label: "Total roles", value: String(s.totalRoles) },
    {
      label: "Required",
      value: `${s.assignedRequiredRoles} / ${s.requiredRoles}`,
      tone: s.assignedRequiredRoles < s.requiredRoles ? "warn" : "ok",
    },
    { label: "AI", value: String(s.byKind.ai) },
    { label: "AI Creative", value: String(s.byKind.ai_creative) },
    { label: "Live Person", value: String(s.byKind.live_person) },
    {
      label: "Roster",
      value: s.rosterApprovedAt ? "Approved" : "Draft",
      tone: s.rosterApprovedAt ? "ok" : undefined,
    },
  ];
  return (
    <Panel eyebrow="Team" title="At a glance">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <div
            key={t.label}
            className={
              "rounded-md border px-3 py-2 " +
              (t.tone === "ok"
                ? "border-emerald-700/40 bg-emerald-900/10"
                : t.tone === "warn"
                ? "border-amber-700/40 bg-amber-900/10"
                : "border-white/8 bg-white/[0.02]")
            }
          >
            <div className="text-[10px] uppercase tracking-wide text-bone-500">
              {t.label}
            </div>
            <div className="font-serif text-xl text-bone-50">{t.value}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

function FilterBar({
  filter,
  setFilter,
  byKind,
}: {
  filter: FilterKind;
  setFilter: (f: FilterKind) => void;
  byKind: Record<RoleKind, number>;
}) {
  const buttons: Array<{ key: FilterKind; label: string; count: number | null }> = [
    { key: "all", label: "All", count: null },
    { key: "unassigned", label: "Unassigned", count: null },
    { key: "ai", label: ROLE_KIND_LABEL.ai, count: byKind.ai },
    { key: "ai_creative", label: ROLE_KIND_LABEL.ai_creative, count: byKind.ai_creative },
    { key: "live_person", label: ROLE_KIND_LABEL.live_person, count: byKind.live_person },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
      <span className="text-bone-500">Filter:</span>
      {buttons.map((b) => (
        <button
          key={b.key}
          onClick={() => setFilter(b.key)}
          className={
            "rounded-md border px-2.5 py-1 transition-colors " +
            (filter === b.key
              ? "border-ember-500/60 bg-ember-500/15 text-ember-100"
              : "border-white/10 bg-white/[0.02] text-bone-300 hover:bg-white/[0.05]")
          }
        >
          {b.label}
          {b.count !== null && (
            <span className="ml-1 text-bone-500">· {b.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Role row
// ---------------------------------------------------------------------------

function RoleRow({ slot, onEdit }: { slot: RoleSlot; onEdit: () => void }) {
  const a = slot.assignment;
  return (
    <li>
      <button
        onClick={onEdit}
        className="group flex w-full flex-wrap items-center justify-between gap-3 rounded-md border border-white/8 bg-white/[0.02] p-3 text-left hover:bg-white/[0.04]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-bone-50">
            <span>{slot.definition.label}</span>
            {slot.definition.required && (
              <span className="chip border-amber-700/40 bg-amber-900/15 text-amber-200">
                required
              </span>
            )}
            {a && <KindChip kind={a.kind} />}
          </div>
          <div className="mt-0.5 text-[11.5px] text-bone-400">
            {a ? (
              <>
                <span className="text-bone-200">{a.label}</span>
                {a.notes ? <span> · {a.notes.slice(0, 80)}</span> : null}
              </>
            ) : (
              slot.definition.description
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-bone-400 transition-transform group-hover:translate-x-0.5" />
      </button>
    </li>
  );
}

function KindChip({ kind }: { kind: RoleKind }) {
  const tone =
    kind === "ai"
      ? "border-violet-700/40 bg-violet-900/15 text-violet-200"
      : kind === "ai_creative"
        ? "border-cyan-700/40 bg-cyan-900/15 text-cyan-200"
        : "border-emerald-700/40 bg-emerald-900/15 text-emerald-200";
  return (
    <span className={"chip " + tone}>
      {kind === "ai" ? (
        <Sparkles className="h-3 w-3" />
      ) : kind === "ai_creative" ? (
        <Brain className="h-3 w-3" />
      ) : (
        <User className="h-3 w-3" />
      )}
      {ROLE_KIND_LABEL[kind]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Assignment drawer — modal that handles kind-specific fields
// ---------------------------------------------------------------------------

function AssignmentDrawer({
  projectId,
  slot,
  onClose,
  onSaved,
}: {
  projectId: string;
  slot: RoleSlot;
  onClose: () => void;
  onSaved: (data: TeamRosterResponse) => void;
}) {
  const a = slot.assignment;
  const rec = slot.definition.recommendation;

  // For a brand-new (unassigned) role, pre-fill from the recommendation
  // when one exists. For an existing assignment, respect what was saved.
  const initialKind: RoleKind =
    a?.kind ?? rec?.recommendedKind ?? slot.definition.defaultKind;
  const initialModel: ModelTarget =
    a?.modelTarget ?? rec?.recommendedModelTarget ?? "veo";
  const initialBriefStyle: CreativeBriefStyle =
    a?.creativeBriefStyle ?? rec?.recommendedBriefStyle ?? "department_note";
  const initialHandoff: HandoffFormat =
    a?.handoffFormat ?? rec?.recommendedHandoffFormat ?? "human_brief";

  const [kind, setKind] = useState<RoleKind>(initialKind);
  const [label, setLabel] = useState<string>(a?.label ?? "");
  const [notes, setNotes] = useState<string>(a?.notes ?? "");
  const [modelTarget, setModelTarget] = useState<ModelTarget>(initialModel);
  const [profileId, setProfileId] = useState<string>(a?.profileId ?? "");
  const [avoidList, setAvoidList] = useState<string>(
    a?.avoidList ? a.avoidList.join(", ") : ""
  );
  const [creativeBriefStyle, setCreativeBriefStyle] =
    useState<CreativeBriefStyle>(initialBriefStyle);
  const [personName, setPersonName] = useState<string>(a?.personName ?? "");
  const [personEmail, setPersonEmail] = useState<string>(a?.personEmail ?? "");
  const [handoffFormat, setHandoffFormat] = useState<HandoffFormat>(initialHandoff);

  const allowedKinds: RoleKind[] = rec?.allowedKinds ?? [...ROLE_KINDS];
  const allowedModels: ModelTarget[] = useMemo(() => {
    if (rec?.allowedModelTargets && rec.allowedModelTargets.length > 0) {
      return rec.allowedModelTargets;
    }
    return [...MODEL_TARGETS];
  }, [rec]);

  // If the saved model is no longer in the allowed list for this role
  // (e.g. legacy data after we tightened recommendations), clamp it to
  // the recommended one so the picker is consistent with the rules.
  if (!allowedModels.includes(modelTarget) && allowedModels.length > 0) {
    queueMicrotask(() => setModelTarget(allowedModels[0]));
  }

  function applyRecommendation() {
    if (!rec) return;
    setKind(rec.recommendedKind);
    if (rec.recommendedModelTarget) setModelTarget(rec.recommendedModelTarget);
    if (rec.recommendedBriefStyle) setCreativeBriefStyle(rec.recommendedBriefStyle);
    if (rec.recommendedHandoffFormat) setHandoffFormat(rec.recommendedHandoffFormat);
    if (!label.trim()) {
      setLabel(suggestDefaultLabel(slot, rec.recommendedKind));
    }
  }

  const saveM = useMutation({
    mutationFn: () => {
      const body: RoleAssignmentPatch = {
        kind,
        label: label.trim() || suggestDefaultLabel(slot, kind),
        notes: notes.trim() || undefined,
      };
      if (kind === "ai") {
        body.modelTarget = modelTarget;
        if (profileId.trim()) body.profileId = profileId.trim();
        const avoid = avoidList
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (avoid.length > 0) body.avoidList = avoid;
      } else if (kind === "ai_creative") {
        body.creativeBriefStyle = creativeBriefStyle;
      } else if (kind === "live_person") {
        if (personName.trim()) body.personName = personName.trim();
        if (personEmail.trim()) body.personEmail = personEmail.trim();
        body.handoffFormat = handoffFormat;
      }
      return api.upsertRoleAssignment(projectId, slot.definition.key, body);
    },
    onSuccess: onSaved,
  });

  const removeM = useMutation({
    mutationFn: () => api.deleteRoleAssignment(projectId, slot.definition.key),
    onSuccess: onSaved,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-[480px] flex-col overflow-hidden border-l border-white/15 bg-graphite-950 shadow-[0_0_60px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/10 bg-graphite-950/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.18em] text-bone-500">
              {ROLE_CATEGORY_LABEL[slot.definition.category]}
              {slot.definition.required && (
                <span className="ml-2 text-amber-300">· required</span>
              )}
            </div>
            <h3 className="mt-0.5 font-serif text-xl text-bone-50">
              {slot.definition.label}
            </h3>
            <p className="mt-1 text-[12px] leading-snug text-bone-400">
              {slot.definition.description}
            </p>
          </div>
          <button
            className="rounded-md border border-white/15 bg-white/[0.04] p-2 hover:bg-white/[0.08]"
            onClick={onClose}
            aria-label="Close drawer"
          >
            <X className="h-4 w-4 text-bone-300" />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div className="rounded-md border border-white/8 bg-white/[0.02] px-3 py-2.5 text-[12px] leading-relaxed text-bone-300">
            Assign each role to a real person, an AI creative assistant, or an
            AI generator. Studio OS will create the right handoff materials
            based on this choice.
          </div>

          {rec && (
            <RecommendationCard
              recommendation={rec}
              definition={slot.definition}
              isApplied={isRecommendationApplied(rec, {
                kind,
                modelTarget,
                creativeBriefStyle,
                handoffFormat,
              })}
              onApply={applyRecommendation}
            />
          )}

          <div>
            <div className="mb-1.5 text-[12px] font-medium text-bone-200">
              Who will do this job?
            </div>
            <div className="space-y-1.5">
              {ROLE_KINDS.map((k) => {
                const disabled = !allowedKinds.includes(k);
                const selected = kind === k;
                return (
                  <button
                    key={k}
                    onClick={() => !disabled && setKind(k)}
                    disabled={disabled}
                    title={
                      disabled
                        ? `${ROLE_KIND_LABEL[k]} isn't a sensible choice for ${slot.definition.label}.`
                        : undefined
                    }
                    className={
                      "block w-full rounded-md border px-3 py-2 text-left transition-colors " +
                      (disabled
                        ? "cursor-not-allowed border-white/5 bg-white/[0.01] text-bone-600"
                        : selected
                          ? "border-ember-500/60 bg-ember-500/15 text-ember-100"
                          : "border-white/10 bg-white/[0.02] text-bone-200 hover:bg-white/[0.05]")
                    }
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          "inline-block h-3 w-3 rounded-full border " +
                          (selected
                            ? "border-ember-300 bg-ember-400"
                            : "border-white/30 bg-transparent")
                        }
                      />
                      <span className="text-[13px] font-medium">
                        {ROLE_KIND_LABEL[k]}
                      </span>
                    </div>
                    <div className="mt-0.5 pl-5 text-[11.5px] text-bone-400">
                      {ROLE_KIND_DESCRIPTION[k]}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <Field label="Role name shown in the project">
            <input
              className="input w-full"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={suggestDefaultLabel(slot, kind)}
            />
          </Field>

          {kind === "ai" && (
            <>
              <Field label="Model target">
                <select
                  className="input w-full"
                  value={modelTarget}
                  onChange={(e) => setModelTarget(e.target.value as ModelTarget)}
                >
                  {allowedModels.map((m) => (
                    <option key={m} value={m}>
                      {MODEL_TARGET_LABEL[m]}
                    </option>
                  ))}
                </select>
                {rec?.allowedModelTargets &&
                  rec.allowedModelTargets.length < MODEL_TARGETS.length && (
                    <div className="mt-1 text-[10.5px] text-bone-500">
                      Picker filtered to models that make sense for this role.
                    </div>
                  )}
              </Field>
              <Field label="Profile id (optional)">
                <input
                  className="input w-full"
                  value={profileId}
                  onChange={(e) => setProfileId(e.target.value)}
                  placeholder="model_profiles row id or free text"
                />
              </Field>
              <Field label="Avoid list (comma separated)">
                <input
                  className="input w-full"
                  value={avoidList}
                  onChange={(e) => setAvoidList(e.target.value)}
                  placeholder="e.g. portrait orientation, lens flare"
                />
              </Field>
            </>
          )}

          {kind === "ai_creative" && (
            <Field label="Creative brief style">
              <select
                className="input w-full"
                value={creativeBriefStyle}
                onChange={(e) =>
                  setCreativeBriefStyle(e.target.value as CreativeBriefStyle)
                }
              >
                {CREATIVE_BRIEF_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {CREATIVE_BRIEF_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {kind === "live_person" && (
            <>
              <Field label="Person responsible">
                <input
                  className="input w-full"
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                  placeholder="Jane Doe"
                />
              </Field>
              <Field label="Email">
                <input
                  className="input w-full"
                  type="email"
                  value={personEmail}
                  onChange={(e) => setPersonEmail(e.target.value)}
                  placeholder="jane@studio.example"
                />
              </Field>
              <Field label="What should Studio OS prepare for them?">
                <select
                  className="input w-full"
                  value={handoffFormat}
                  onChange={(e) => setHandoffFormat(e.target.value as HandoffFormat)}
                >
                  {HANDOFF_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {HANDOFF_LABEL[f]}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}

          <Field label="Notes">
            <textarea
              className="input min-h-[80px] w-full"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any instructions this person or AI should follow."
            />
          </Field>
        </div>
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 border-t border-white/10 bg-graphite-950/95 px-5 py-4 backdrop-blur">
          <div>
            {a && (
              <button
                className="inline-flex items-center gap-1.5 rounded-md border border-red-700/40 bg-red-900/15 px-2.5 py-1.5 text-[12px] text-red-200 hover:bg-red-900/25"
                onClick={() => {
                  if (
                    window.confirm(
                      `Clear assignment for ${slot.definition.label}? This only affects project metadata.`
                    )
                  ) {
                    removeM.mutate();
                  }
                }}
                disabled={removeM.isPending}
              >
                {removeM.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Clear
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose} disabled={saveM.isPending}>
              Cancel
            </Button>
            <Button onClick={() => saveM.mutate()} disabled={saveM.isPending}>
              {saveM.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Save assignment
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recommendation card (inside drawer)
// ---------------------------------------------------------------------------

function RecommendationCard({
  recommendation,
  definition,
  isApplied,
  onApply,
}: {
  recommendation: RoleRecommendation;
  definition: RoleDefinition;
  isApplied: boolean;
  onApply: () => void;
}) {
  void definition;
  const bits: string[] = [ROLE_KIND_LABEL[recommendation.recommendedKind]];
  if (recommendation.recommendedKind === "ai" && recommendation.recommendedModelTarget) {
    bits.push(MODEL_TARGET_LABEL[recommendation.recommendedModelTarget]);
  }
  if (
    recommendation.recommendedKind === "ai_creative" &&
    recommendation.recommendedBriefStyle
  ) {
    bits.push(CREATIVE_BRIEF_LABEL[recommendation.recommendedBriefStyle]);
  }
  if (
    recommendation.recommendedKind === "live_person" &&
    recommendation.recommendedHandoffFormat
  ) {
    bits.push(HANDOFF_LABEL[recommendation.recommendedHandoffFormat]);
  }
  return (
    <div className="rounded-lg border border-amber-700/35 bg-amber-900/[0.08] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wide text-amber-200">
          <Lightbulb className="h-3.5 w-3.5" />
          Recommended for this role
        </div>
        {isApplied && (
          <span className="chip border-emerald-700/40 bg-emerald-900/15 text-emerald-200">
            <Check className="h-3 w-3" />
            Applied
          </span>
        )}
      </div>
      <div className="mt-1.5 font-serif text-base text-bone-50">
        {bits.join(" · ")}
      </div>
      <div className="mt-1 text-[12px] leading-snug text-bone-300">
        {recommendation.reason}
      </div>
      {!isApplied && (
        <button
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-600/50 bg-amber-500/15 px-2.5 py-1.5 text-[12px] text-amber-100 hover:bg-amber-500/25"
          onClick={onApply}
        >
          <Wand2 className="h-3.5 w-3.5" />
          Use recommendation
        </button>
      )}
    </div>
  );
}

function isRecommendationApplied(
  rec: RoleRecommendation,
  current: {
    kind: RoleKind;
    modelTarget: ModelTarget;
    creativeBriefStyle: CreativeBriefStyle;
    handoffFormat: HandoffFormat;
  }
): boolean {
  if (current.kind !== rec.recommendedKind) return false;
  if (rec.recommendedKind === "ai") {
    return current.modelTarget === rec.recommendedModelTarget;
  }
  if (rec.recommendedKind === "ai_creative") {
    return current.creativeBriefStyle === rec.recommendedBriefStyle;
  }
  if (rec.recommendedKind === "live_person") {
    return current.handoffFormat === rec.recommendedHandoffFormat;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Bulk apply modal + toast
// ---------------------------------------------------------------------------

function BulkApplyModal({
  pending,
  summary,
  onClose,
  onApply,
}: {
  pending: boolean;
  summary: TeamRosterResponse["summary"];
  onClose: () => void;
  onApply: (opts: { overwriteExisting: boolean; includeOptional: boolean }) => void;
}) {
  const [overwriteExisting, setOverwrite] = useState(false);
  const [includeOptional, setIncludeOptional] = useState(false);
  const unassignedRequired = Math.max(
    0,
    summary.requiredRoles - summary.assignedRequiredRoles
  );
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-white/15 bg-graphite-950 p-5 shadow-[0_0_60px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-amber-300" />
          <h3 className="font-serif text-lg text-bone-50">Apply recommended setup</h3>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-bone-300">
          Fill in defaults for every <span className="text-amber-200">required</span>{" "}
          role that's still unassigned. You currently have{" "}
          <span className="text-bone-100">{unassignedRequired}</span> unassigned
          required role{unassignedRequired === 1 ? "" : "s"}.
        </p>
        <p className="mt-1 text-[12px] text-bone-500">
          You can edit any role afterwards in the drawer.
        </p>
        <div className="mt-4 space-y-2">
          <label className="flex items-start gap-2 text-[13px] text-bone-200">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={overwriteExisting}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            <span>
              <span className="text-bone-100">Overwrite existing assignments</span>
              <span className="block text-[11.5px] text-bone-500">
                Off: skip roles that already have an assignment.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-[13px] text-bone-200">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={includeOptional}
              onChange={(e) => setIncludeOptional(e.target.checked)}
            />
            <span>
              <span className="text-bone-100">Include optional roles</span>
              <span className="block text-[11.5px] text-bone-500">
                On: also fill in non-required slots (Editor, Composer, etc.).
              </span>
            </span>
          </label>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={() => onApply({ overwriteExisting, includeOptional })}
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            Apply defaults
          </Button>
        </div>
      </div>
    </div>
  );
}

function BulkResultToast({
  result,
  onClose,
}: {
  result: { assigned: number; skipped: number };
  onClose: () => void;
}) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-emerald-700/40 bg-emerald-950/80 px-4 py-3 shadow-2xl backdrop-blur">
      <Check className="h-4 w-4 text-emerald-300" />
      <div className="text-[13px] text-bone-100">
        <span className="text-emerald-200">{result.assigned}</span> role
        {result.assigned === 1 ? "" : "s"} assigned ·{" "}
        <span className="text-bone-400">{result.skipped} skipped</span>
      </div>
      <button
        className="rounded-md border border-white/10 bg-white/[0.04] p-1 hover:bg-white/[0.08]"
        onClick={onClose}
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5 text-bone-300" />
      </button>
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
      <div className="mb-1 text-[10.5px] uppercase tracking-wide text-bone-500">
        {label}
      </div>
      {children}
    </div>
  );
}

function suggestDefaultLabel(slot: RoleSlot, kind: RoleKind): string {
  const base = slot.definition.label;
  switch (kind) {
    case "ai":
      return `AI · ${base}`;
    case "ai_creative":
      return `AI Creative · ${base}`;
    case "live_person":
    default:
      return base;
  }
}

// Silence unused-import warning for icons we keep for future stages.
void ArrowRight;
void Users;
// Make sure ts-unused-imports isn't tripped by the type-only RoleAssignment
// import (used implicitly via patches).
void (null as unknown as RoleAssignment);
