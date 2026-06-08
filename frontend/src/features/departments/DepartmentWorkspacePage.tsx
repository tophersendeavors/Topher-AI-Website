// Department Workspace — single component backing all department detail pages.
// Dark theme to match the app shell.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  Check, ChevronLeft, ExternalLink, Image as ImageIcon, Link2,
  Loader2, PaintBucket, Plus, StickyNote, X,
} from "lucide-react";
import {
  api,
  type ContributionKind,
  type ContributionStatus,
  type DepartmentContribution,
  type DepartmentEntry,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { CanonTargetPicker } from "@/features/workflow/CanonTargetPicker";
import { ImpactPreview } from "@/features/workflow/ImpactPreview";

const TABS = ["Overview", "References", "Approved Canon", "Activity"] as const;
type Tab = typeof TABS[number];

const STATUS_STYLE: Record<ContributionStatus, string> = {
  inspiration: "bg-white/[0.06] text-bone-300 ring-white/10",
  candidate: "bg-amber-900/40 text-amber-200 ring-amber-700/40",
  approved: "bg-emerald-900/40 text-emerald-200 ring-emerald-700/40",
  rejected: "bg-red-900/40 text-red-200 ring-red-700/40",
  archived: "bg-white/[0.04] text-bone-500 ring-white/10",
};

const KIND_ICON: Record<ContributionKind, typeof StickyNote> = {
  note: StickyNote,
  image: ImageIcon,
  url: Link2,
  pdf: ImageIcon,
  color: PaintBucket,
  material: PaintBucket,
  moodboard: ImageIcon,
};

/** Translate a raw canonFieldPath like
 *  `locationBibles.INT_MAYA_BEDROOM_NIGHT.setDressing.bedding.comforterColor`
 *  into a friendly cascade like
 *  `MAYA'S BEDROOM › Set Dressing › Bedding › Comforter color`.
 *  Never expose the raw path string to a non-technical user (UX_RULES #1). */
function humanizeCanonFieldPath(path: string): string {
  if (!path) return "";
  const parts = path.split(".");
  const out: string[] = [];
  const titleCase = (s: string) =>
    s
      .replace(/([A-Z])/g, " $1")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  if (parts[0] === "locationBibles" && parts.length >= 3) {
    out.push(parts[1].replace(/_/g, " ").trim());
    for (let i = 2; i < parts.length; i++) out.push(titleCase(parts[i]));
    return out.join(" › ");
  }
  if (parts[0] === "propBibles" && parts.length >= 2) {
    out.push("Prop: " + parts[1].replace(/_/g, " "));
    for (let i = 2; i < parts.length; i++) out.push(titleCase(parts[i]));
    return out.join(" › ");
  }
  if (parts[0] === "characters" && parts.length >= 4) {
    out.push("Character");
    for (let i = 2; i < parts.length; i++) {
      if (parts[i] === "visualBible") continue;
      out.push(titleCase(parts[i]));
    }
    return out.join(" › ");
  }
  if (parts[0] === "shotBriefs" && parts.length >= 4) {
    const sc = Number(parts[1]) + 1;
    return `SC${String(sc).padStart(2, "0")} SH${String(parts[2]).padStart(2, "0")} › ${titleCase(parts[3])}`;
  }
  return parts.map(titleCase).join(" › ");
}

export function DepartmentWorkspacePage() {
  const { projectId, deptKey } = useParams<{ projectId: string; deptKey: string }>();
  if (!projectId || !deptKey) return null;
  return <DepartmentWorkspaceContent projectId={projectId} deptKey={deptKey} />;
}

/** Same UI without the URL-param wrapper — for embedding inside the
 *  Episode Workflow stage detail. */
export function DepartmentWorkspaceContent({
  projectId,
  deptKey,
  scriptId,
}: {
  projectId: string;
  deptKey: string;
  /** Optional — when present, the contribution form embeds the
   *  ImpactPreview widget so Live Person users see which shots their
   *  approval will affect, mirroring the AI Proposal view. UX_RULES #4. */
  scriptId?: string;
}) {
  const qc = useQueryClient();

  const deptsQ = useQuery({
    queryKey: ["departments", projectId],
    queryFn: () => api.listDepartments(projectId),
  });
  const dept = useMemo<DepartmentEntry | undefined>(
    () => deptsQ.data?.registry.find((d) => d.key === deptKey),
    [deptsQ.data, deptKey]
  );

  const contributionsQ = useQuery({
    queryKey: ["contributions", projectId, deptKey],
    queryFn: () => api.listContributions(projectId, deptKey),
  });
  const activityQ = useQuery({
    queryKey: ["dept-activity", projectId, deptKey],
    queryFn: () => api.listDepartmentActivity(projectId, deptKey),
  });

  const [tab, setTab] = useState<Tab>("References");
  const [adding, setAdding] = useState<ContributionKind | null>(null);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["departments", projectId] });
    qc.invalidateQueries({ queryKey: ["contributions", projectId, deptKey] });
    qc.invalidateQueries({ queryKey: ["dept-activity", projectId, deptKey] });
  };

  if (deptsQ.isLoading) {
    return (
      <div className="p-6 text-sm text-bone-400">
        <Loader2 className="inline animate-spin h-4 w-4 mr-1" /> Loading…
      </div>
    );
  }
  if (!dept) {
    return <div className="p-6 text-sm text-red-300">Department "{deptKey}" not found.</div>;
  }

  const all = contributionsQ.data ?? [];
  const approved = all.filter((c) => c.status === "approved");
  const candidates = all.filter(
    (c) => c.status !== "approved" && c.status !== "rejected" && c.status !== "archived"
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <Link
        to={`/projects/${projectId}/departments`}
        className="inline-flex items-center text-xs text-bone-500 hover:text-bone-200"
      >
        <ChevronLeft size={12} /> All departments
      </Link>

      <Panel
        eyebrow={`Department · ${dept.canonOwner ? "Canon owner" : "Advisory"}`}
        title={dept.label}
      >
        <p className="text-sm text-bone-400">{dept.description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-white/[0.06] ring-1 ring-white/10 px-2 py-0.5 text-bone-300">
            Mode: <strong className="text-bone-100">{dept.config.mode}</strong>
          </span>
          <span className="rounded-full bg-white/[0.06] ring-1 ring-white/10 px-2 py-0.5 text-bone-300">
            Approved canon fields: <strong className="text-bone-100">{dept.approvedCanonFields}</strong>
          </span>
          <span className="rounded-full bg-white/[0.06] ring-1 ring-white/10 px-2 py-0.5 text-bone-300">
            Contributions: {dept.contributionCounts.total} ·{" "}
            <span className="text-emerald-300">{dept.contributionCounts.approved} approved</span>
            {dept.contributionCounts.candidate > 0 && (
              <>
                {" · "}
                <span className="text-amber-300">
                  {dept.contributionCounts.candidate} candidate
                </span>
              </>
            )}
          </span>
          {dept.config.locked && (
            <span className="rounded-full bg-white/[0.1] px-2 py-0.5 text-bone-100">Locked</span>
          )}
        </div>

        <nav className="mt-4 flex gap-1 border-b border-white/10 text-sm">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "px-3 py-1.5 -mb-px border-b-2 " +
                (tab === t
                  ? "border-bone-50 text-bone-50 font-medium"
                  : "border-transparent text-bone-400 hover:text-bone-100")
              }
            >
              {t}
            </button>
          ))}
        </nav>

        {tab === "Overview" && (
          <div className="mt-4 space-y-3 text-sm">
            <div>
              <div className="font-serif text-bone-100 text-base">What this department owns</div>
              <ul className="mt-1 list-disc pl-5 space-y-0.5 text-bone-300">
                {dept.ownedFieldPaths.length === 0 && (
                  <li className="text-bone-500">Advisory only — no canon fields owned.</li>
                )}
                {dept.ownedFieldPaths.map((p) => (
                  <li key={p} className="text-[12px]">
                    {humanizeCanonFieldPath(p)}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-serif text-bone-100 text-base">Recent activity</div>
              <ul className="mt-1 space-y-0.5 text-xs text-bone-300">
                {(activityQ.data ?? []).slice(0, 5).map((a) => (
                  <li key={a.id}>
                    <span className="text-bone-500">{relTime(a.created_at)}</span>{" "}
                    — {a.action.replace(/_/g, " ")}
                    {a.notes ? ` · ${a.notes.slice(0, 80)}` : ""}
                  </li>
                ))}
                {(activityQ.data ?? []).length === 0 && (
                  <li className="text-bone-500">(no activity yet)</li>
                )}
              </ul>
            </div>
          </div>
        )}

        {(tab === "References" || tab === "Approved Canon") && (
          <div className="mt-4">
            <div className="flex flex-wrap gap-2 items-center mb-3">
              <span className="text-xs text-bone-400 mr-2">Add:</span>
              <Button size="sm" variant="outline" onClick={() => setAdding("image")}>
                <ImageIcon size={12} className="mr-1" /> Image
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAdding("url")}>
                <Link2 size={12} className="mr-1" /> URL
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAdding("note")}>
                <StickyNote size={12} className="mr-1" /> Note
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAdding("color")}>
                <PaintBucket size={12} className="mr-1" /> Color
              </Button>
            </div>

            {adding && (
              <ContributionForm
                projectId={projectId}
                deptKey={deptKey}
                scriptId={scriptId}
                kind={adding}
                onClose={() => setAdding(null)}
                onSaved={() => {
                  refreshAll();
                  setAdding(null);
                }}
              />
            )}

            <ContributionList
              items={tab === "Approved Canon" ? approved : candidates}
              onChange={refreshAll}
            />
          </div>
        )}

        {tab === "Activity" && (
          <ul className="mt-4 space-y-1.5 text-xs text-bone-200">
            {(activityQ.data ?? []).map((a) => (
              <li key={a.id} className="flex gap-2 border-b border-white/8 pb-1.5">
                <span className="text-bone-500 w-24 shrink-0">{relTime(a.created_at)}</span>
                <span>
                  <strong className="text-bone-100">{a.action.replace(/_/g, " ")}</strong>
                  {a.notes ? <span className="text-bone-400"> — {a.notes}</span> : null}
                </span>
              </li>
            ))}
            {(activityQ.data ?? []).length === 0 && (
              <li className="text-bone-500">(no activity yet)</li>
            )}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const d = Math.floor((Date.now() - t) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

// ============================================================================
// Contribution form (dark theme)
// ============================================================================

function ContributionForm({
  projectId,
  deptKey,
  scriptId,
  kind,
  onClose,
  onSaved,
}: {
  projectId: string;
  deptKey: string;
  /** When set, ImpactPreview renders below the picker so the user sees
   *  which shots their approval will affect (UX_RULES rule #4). */
  scriptId?: string;
  kind: ContributionKind;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState("#2A2A30");
  const [canonFieldPath, setCanonFieldPath] = useState("");
  const [canonOverrideText, setCanonOverrideText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // Vision extraction: cached upload result (so we don't re-upload on Save)
  // and the model's observed-vs-suggested response for the UI to render.
  const [uploadedRef, setUploadedRef] = useState<{
    storage_path: string;
    thumbnail_url: string;
  } | null>(null);
  const [visionResult, setVisionResult] = useState<{
    observed: string;
    suggestedValue: string;
  } | null>(null);

  // Reuse the upload across Vision Extract and Save so we hit signed PUT
  // once per file. If the user picks a different file, this resets.
  async function ensureUpload(): Promise<{ storage_path: string; thumbnail_url: string }> {
    if (uploadedRef) return uploadedRef;
    if (!file) throw new Error("no file selected");
    const signed = await api.signDepartmentUploadUrl(projectId, {
      filename: file.name,
      contentType: file.type || "image/jpeg",
      department: deptKey,
    });
    const putRes = await fetch(signed.upload_url, {
      method: "PUT",
      body: file,
      headers: { "content-type": file.type || "image/jpeg" },
    });
    if (!putRes.ok) throw new Error("upload failed");
    const out = {
      storage_path: signed.storage_path,
      thumbnail_url: signed.public_read_url ?? "",
    };
    setUploadedRef(out);
    return out;
  }

  const extractVision = useMutation({
    mutationFn: async () => {
      if (!canonFieldPath.trim()) {
        throw new Error("Pick a canon target first.");
      }
      const uploaded = await ensureUpload();
      if (!uploaded.thumbnail_url) {
        throw new Error("Image not yet publicly readable — try again in a moment.");
      }
      const out = await api.extractCanonFromImage(projectId, {
        imageUrl: uploaded.thumbnail_url,
        canonFieldPath: canonFieldPath.trim(),
      });
      setVisionResult({ observed: out.observed, suggestedValue: out.suggestedValue });
      // Pre-fill the canon override textarea with the suggestion so the
      // user can edit before approving.
      setCanonOverrideText(out.suggestedValue);
      return out;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      let storage_path: string | undefined;
      let thumbnail_url: string | undefined;
      if (kind === "image" && file) {
        const uploaded = await ensureUpload();
        storage_path = uploaded.storage_path;
        thumbnail_url = uploaded.thumbnail_url || undefined;
      }
      const links: Record<string, unknown> = {};
      if (canonFieldPath.trim()) links.canonFieldPath = canonFieldPath.trim();
      if (canonOverrideText.trim()) links.canonOverrideText = canonOverrideText.trim();
      return api.createContribution(projectId, deptKey, {
        kind,
        title: title.trim() || undefined,
        body: body.trim() || undefined,
        url: kind === "url" ? url.trim() || undefined : undefined,
        color_hex: kind === "color" ? color : undefined,
        storage_path,
        thumbnail_url,
        links,
        status: "candidate",
      });
    },
    onSuccess: onSaved,
  });

  const inputCls =
    "w-full rounded border border-white/10 bg-white/[0.04] text-bone-100 placeholder:text-bone-500 px-2 py-1 text-xs";

  // ---- Wizard step model ----
  // Five linear steps. Step gating is computed from the same state the
  // form already manages, so existing logic (upload, picker, vision,
  // impact, create) is preserved — only the layout changes.
  type WizStep = 1 | 2 | 3 | 4 | 5;
  const [step, setStep] = useState<WizStep>(1);

  const referenceReady =
    (kind === "image" && !!file) ||
    (kind === "url" && url.trim().length > 0) ||
    kind === "note" ||
    kind === "color";
  const targetReady = canonFieldPath.trim().length > 0;
  const textReady = canonOverrideText.trim().length > 0;

  const stepMeta: Array<{ n: WizStep; label: string; ready: boolean }> = [
    { n: 1, label: "Add Reference", ready: referenceReady },
    { n: 2, label: "Choose Canon Target", ready: targetReady },
    { n: 3, label: "Extract / Write Canon Text", ready: textReady },
    { n: 4, label: "Preview Prompt Impact", ready: !!scriptId && targetReady },
    { n: 5, label: "Submit", ready: referenceReady && targetReady && textReady },
  ];

  const canAdvance = (from: WizStep): boolean => {
    if (from === 1) return referenceReady;
    if (from === 2) return targetReady;
    if (from === 3) return textReady;
    if (from === 4) return true; // preview is informational
    return false;
  };

  return (
    <div className="os-card p-4 mb-4 space-y-4">
      {/* Header + close */}
      <div className="flex items-center justify-between">
        <div>
          <div className="os-eyebrow os-eyebrow-gold">Live Person contribution</div>
          <div className="text-sm text-bone-100 mt-0.5 capitalize">
            New {kind} — guided 5-step submission
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-bone-500 hover:text-bone-100"
          aria-label="Close wizard"
        >
          <X size={14} />
        </button>
      </div>

      {/* Step rail — clickable dots so the user can jump back to fix
         anything, but only forward into a step whose prerequisites
         are met (canAdvance). */}
      <ol
        className="flex items-center gap-2 text-[11px]"
        aria-label="Wizard steps"
      >
        {stepMeta.map((m, i) => {
          const isActive = step === m.n;
          const isDone = m.ready && step > m.n;
          const allowJump = m.n < step || (m.n > step && stepMeta.slice(0, m.n - 1).every((p) => p.ready));
          return (
            <li key={m.n} className="flex items-center gap-2">
              <button
                type="button"
                disabled={!allowJump && !isActive}
                onClick={() => allowJump && setStep(m.n)}
                className={
                  "flex items-center gap-2 rounded-full px-2.5 py-1 transition " +
                  (isActive
                    ? "bg-amber-900/40 text-amber-100 ring-1 ring-amber-700/50"
                    : isDone
                      ? "text-emerald-200 hover:bg-white/[0.05]"
                      : "text-bone-400 hover:bg-white/[0.04] disabled:opacity-40 disabled:cursor-not-allowed")
                }
              >
                <span
                  className={
                    "inline-grid place-items-center w-4 h-4 rounded-full text-[9px] font-semibold " +
                    (isActive
                      ? "bg-amber-200 text-amber-950"
                      : isDone
                        ? "bg-emerald-400 text-emerald-950"
                        : "bg-white/[0.08] text-bone-300")
                  }
                >
                  {isDone ? <Check size={9} /> : m.n}
                </span>
                <span className="hidden sm:inline">{m.label}</span>
              </button>
              {i < stepMeta.length - 1 && (
                <span className="text-bone-600">·</span>
              )}
            </li>
          );
        })}
      </ol>

      {/* ===== Step 1 — Add Reference ===== */}
      {step === 1 && (
        <section className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-bone-400">
            Step 1 — Add a reference
          </div>
          <p className="text-[11px] text-bone-500">
            Upload an image, paste a link, drop a color swatch, or write a quick note. This is what you'd hand the director.
          </p>

          {kind === "image" && (
            <div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setUploadedRef(null);
                  setVisionResult(null);
                }}
                className="block text-xs text-bone-200 file:mr-2 file:rounded file:border file:border-white/10 file:bg-white/[0.04] file:px-2 file:py-1 file:text-bone-200"
              />
              {file && (
                <div className="mt-1 text-[11px] text-bone-400">
                  {file.name} · {(file.size / 1024).toFixed(0)} KB
                </div>
              )}
            </div>
          )}

          {kind === "url" && (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… (product link, reference URL, paint swatch)"
              className={inputCls}
            />
          )}

          {kind === "color" && (
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-8 w-12 rounded border border-white/10 bg-transparent"
              />
              <code className="text-xs text-bone-200">{color}</code>
            </div>
          )}

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (e.g. 'Deep charcoal heather comforter')"
            className={inputCls}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Notes / description (optional)"
            rows={2}
            className={inputCls}
          />
        </section>
      )}

      {/* ===== Step 2 — Choose Canon Target ===== */}
      {step === 2 && (
        <section className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-bone-400">
            Step 2 — Where should this become canon?
          </div>
          <p className="text-[11px] text-bone-500">
            Pick the bible field this reference defines (e.g. "Maya's bedroom › bedding › comforter color"). Future prompts will inherit it.
          </p>
          <CanonTargetPicker
            projectId={projectId}
            filterDepartmentKey={deptKey}
            fieldPath={canonFieldPath}
            canonOverrideText={canonOverrideText}
            onChange={(next) => {
              setCanonFieldPath(next.fieldPath);
              setCanonOverrideText(next.canonOverrideText);
            }}
          />
          {canonFieldPath.trim() && (
            <div className="text-[11px] text-emerald-300">
              ✓ Target picked: <span className="text-bone-100">{humanizeCanonFieldPath(canonFieldPath)}</span>
            </div>
          )}
        </section>
      )}

      {/* ===== Step 3 — Extract / Write Canon Text ===== */}
      {step === 3 && (
        <section className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-bone-400">
            Step 3 — Write the canon
          </div>
          <p className="text-[11px] text-bone-500">
            One or two sentences the AI prompt composer can use verbatim. {kind === "image" ? "You can let Vision describe the image, then edit." : "Write what should be true in every shot affected."}
          </p>

          {kind === "image" && file && canonFieldPath.trim() && (
            <div className="rounded border border-white/8 bg-white/[0.02] p-2 space-y-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => extractVision.mutate()}
                disabled={extractVision.isPending}
                title="Describe the image with AI and pre-fill the canon text below."
              >
                {extractVision.isPending ? (
                  <Loader2 size={12} className="mr-1 animate-spin" />
                ) : (
                  <ImageIcon size={12} className="mr-1" />
                )}
                ✨ Extract canon text from image
              </Button>
              {extractVision.error && (
                <div className="mt-1 text-[11px] text-red-300">
                  Vision extract failed: {(extractVision.error as Error).message}
                </div>
              )}
              {visionResult && (
                <div className="rounded border border-sky-700/30 bg-sky-900/10 p-2 text-[11px]">
                  <div className="text-bone-400 italic line-clamp-3">
                    AI observed: {visionResult.observed}
                  </div>
                  <div className="mt-1 text-emerald-200">
                    Pre-filled below — edit if needed.
                  </div>
                </div>
              )}
            </div>
          )}
          {kind === "image" && file && !canonFieldPath.trim() && (
            <div className="text-[11px] text-amber-300">
              Pick a canon target in Step 2 first to unlock Vision Extract.
            </div>
          )}

          <textarea
            value={canonOverrideText}
            onChange={(e) => setCanonOverrideText(e.target.value)}
            placeholder="e.g. 'Deep charcoal heather comforter with a faint cable knit pattern; matte cotton finish; takes warm light slightly cooler than expected.'"
            rows={5}
            className={inputCls}
          />
          <div className="text-[10px] text-bone-500">
            This text becomes the bible value at the target you picked.
          </div>
        </section>
      )}

      {/* ===== Step 4 — Preview Prompt Impact ===== */}
      {step === 4 && (
        <section className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-bone-400">
            Step 4 — Preview what this changes
          </div>
          <p className="text-[11px] text-bone-500">
            Which shots will the prompt composer rewrite once this is approved. You can still go back to refine the canon text before submitting.
          </p>
          {scriptId && canonFieldPath.trim() ? (
            <ImpactPreview
              scriptId={scriptId}
              canonFieldPath={canonFieldPath.trim()}
            />
          ) : (
            <div className="rounded border border-white/8 bg-white/[0.02] p-3 text-[11px] text-bone-400">
              {!scriptId
                ? "No active episode in scope — impact preview will appear once this contribution flows into an episode workflow."
                : "Pick a canon target in Step 2 to see prompt impact."}
            </div>
          )}
        </section>
      )}

      {/* ===== Step 5 — Submit ===== */}
      {step === 5 && (
        <section className="space-y-3">
          <div className="text-[11px] uppercase tracking-wide text-bone-400">
            Step 5 — Submit for canon approval
          </div>
          <div className="rounded border border-white/10 bg-white/[0.03] p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-[11px]">
              <Check size={11} className="text-emerald-300" />
              <span className="text-bone-300">Reference attached ({kind})</span>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <Check size={11} className="text-emerald-300" />
              <span className="text-bone-300">
                Canon target:{" "}
                <span className="text-bone-100">{humanizeCanonFieldPath(canonFieldPath)}</span>
              </span>
            </div>
            <div className="flex items-start gap-2 text-[11px]">
              <Check size={11} className="text-emerald-300 mt-0.5 shrink-0" />
              <span className="text-bone-300 whitespace-pre-wrap leading-snug">
                Canon text: <span className="text-bone-100">{canonOverrideText.trim().slice(0, 220)}{canonOverrideText.trim().length > 220 ? "…" : ""}</span>
              </span>
            </div>
          </div>
          <p className="text-[11px] text-bone-500">
            This will be saved as a <strong className="text-amber-200">candidate</strong>. The department canon owner reviews candidates before they flow into prompts.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => create.mutate()}
              disabled={create.isPending || !referenceReady || !targetReady || !textReady}
            >
              {create.isPending ? (
                <Loader2 size={12} className="mr-1 animate-spin" />
              ) : (
                <Plus size={12} className="mr-1" />
              )}
              Submit as candidate
            </Button>
            <Button size="sm" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
          {create.error && (
            <div className="text-xs text-red-300">{(create.error as Error).message}</div>
          )}
        </section>
      )}

      {/* Footer nav — Back / Next */}
      {step < 5 && (
        <div className="flex items-center justify-between border-t border-white/8 pt-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setStep((s) => Math.max(1, (s - 1) as WizStep) as WizStep)}
            disabled={step === 1}
          >
            <ChevronLeft size={12} className="mr-1" /> Back
          </Button>
          <div className="text-[10px] text-bone-500">
            {step === 1 && (!referenceReady ? "Attach a reference to continue" : "Reference attached — continue")}
            {step === 2 && (!targetReady ? "Pick a canon target" : "Target picked — continue")}
            {step === 3 && (!textReady ? "Write or extract the canon text" : "Canon text ready — preview impact")}
            {step === 4 && "Looks right? Continue to submit"}
          </div>
          <Button
            size="sm"
            onClick={() => setStep((s) => Math.min(5, (s + 1) as WizStep) as WizStep)}
            disabled={!canAdvance(step)}
          >
            Next →
          </Button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Contribution list + cards (dark theme)
// ============================================================================

function ContributionList({
  items,
  onChange,
}: {
  items: DepartmentContribution[];
  onChange: () => void;
}) {
  if (items.length === 0) {
    return (
      <div className="text-sm text-bone-500 py-6 text-center">
        No contributions in this tab yet.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {items.map((c) => (
        <ContributionCard key={c.id} c={c} onChange={onChange} />
      ))}
    </div>
  );
}

function ContributionCard({
  c,
  onChange,
}: {
  c: DepartmentContribution;
  onChange: () => void;
}) {
  const KindIcon = KIND_ICON[c.kind];
  const approve = useMutation({
    mutationFn: () => api.approveContribution(c.id),
    onSuccess: onChange,
  });
  const reject = useMutation({
    mutationFn: () => api.rejectContribution(c.id),
    onSuccess: onChange,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteContribution(c.id),
    onSuccess: onChange,
  });
  const fieldPath = c.links?.canonFieldPath as string | undefined;
  const overrideText = c.links?.canonOverrideText as string | undefined;
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] overflow-hidden flex flex-col">
      {c.kind === "image" && c.thumbnail_url && (
        <img src={c.thumbnail_url} alt={c.title ?? ""} className="aspect-video object-cover" />
      )}
      {c.kind === "color" && c.color_hex && (
        <div
          className="aspect-video flex items-center justify-center"
          style={{ background: c.color_hex }}
        >
          <code className="bg-black/60 text-bone-100 px-2 py-0.5 rounded text-xs">
            {c.color_hex}
          </code>
        </div>
      )}
      {c.kind === "url" && c.url && (
        <div className="aspect-video bg-white/[0.04] flex items-center justify-center text-bone-500">
          <Link2 size={32} />
        </div>
      )}
      {c.kind === "note" && (
        <div className="aspect-video bg-amber-900/15 flex items-center justify-center text-amber-300/70">
          <StickyNote size={32} />
        </div>
      )}
      <div className="p-2 space-y-1.5 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <KindIcon size={12} className="text-bone-500 shrink-0" />
            <div className="text-sm font-medium text-bone-100 line-clamp-1">
              {c.title || `(untitled ${c.kind})`}
            </div>
          </div>
          <span
            className={`text-[10px] uppercase tracking-wide rounded-full px-1.5 py-0.5 ring-1 shrink-0 ${STATUS_STYLE[c.status]}`}
          >
            {c.status}
          </span>
        </div>
        {c.body && (
          <div className="text-xs text-bone-300 line-clamp-2 whitespace-pre-wrap">{c.body}</div>
        )}
        {c.url && (
          <a
            href={c.url}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-sky-300 hover:underline inline-flex items-center gap-1 line-clamp-1"
          >
            <ExternalLink size={10} /> {c.url}
          </a>
        )}
        {fieldPath && (
          <div className="text-[11px] text-bone-400">↳ {humanizeCanonFieldPath(fieldPath)}</div>
        )}
        {overrideText && (
          <div className="text-[10px] text-emerald-300">
            Text override: {overrideText}
          </div>
        )}
        <div className="text-[10px] text-bone-500">
          {new Date(c.created_at).toLocaleString()}
        </div>
        <div className="mt-auto pt-1 flex gap-1 flex-wrap">
          {c.status !== "approved" && (
            <Button
              size="sm"
              onClick={() => approve.mutate()}
              disabled={approve.isPending}
              title={fieldPath ? `Bind as canon for ${humanizeCanonFieldPath(fieldPath)}` : "Approve (no canon field — will stay as reference)"}
            >
              {approve.isPending ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Check size={10} />
              )}{" "}
              Approve
            </Button>
          )}
          {c.status !== "rejected" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => reject.mutate()}
              disabled={reject.isPending}
            >
              Reject
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm("Delete this contribution?")) remove.mutate();
            }}
          >
            <X size={10} />
          </Button>
        </div>
        {approve.error && (
          <div className="text-[11px] text-red-300">{(approve.error as Error).message}</div>
        )}
      </div>
    </div>
  );
}
