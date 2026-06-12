import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Pencil, Trash2, Loader2, Mail } from "lucide-react";
import type {
  LivePermission,
  TalentCategory,
  TalentProfile,
  TalentProfileInput,
} from "@toburt/shared";
import {
  LIVE_PERMISSION_LABELS,
  LIVE_PERMISSIONS,
  STUDIO_ROLE_LABELS,
  TALENT_CATEGORIES,
  TALENT_CATEGORY_LABELS,
  TALENT_INVITE_LABELS,
} from "@toburt/shared";
import { api } from "@/lib/api";
import { pickFeatured } from "@/lib/recentProjects";
import { StudioLeftRail } from "@/features/studio/StudioLeftRail";

const GOLD = "#d8b15a";
const gold = { color: GOLD };

export function StudioTalentPage() {
  const qc = useQueryClient();
  const ownerQ = useQuery({ queryKey: ["studio-owner"], queryFn: () => api.getStudioOwner() });
  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: () => api.listProjects() });
  const configQ = useQuery({ queryKey: ["studio-config"], queryFn: () => api.getStudioConfig() });
  const talentQ = useQuery({ queryKey: ["talent"], queryFn: () => api.listTalent() });

  const owner = ownerQ.data?.owner ?? null;
  const config = configQ.data?.config ?? null;
  const approved = config?.concepts.find((c) => c.id === config?.approvedConceptId) ?? null;
  const studioName = approved?.name ?? "TOBURT STUDIOS";
  const ownerName = owner?.name && owner.name !== "chris" ? owner.name : "Studio Owner";
  const ownerTitle = owner?.role ? STUDIO_ROLE_LABELS[owner.role] : "Studio Owner";
  const railFeatured = pickFeatured((projectsQ.data ?? []).filter((p) => p.status !== "archived"));

  const profiles = talentQ.data?.profiles ?? [];
  const [filter, setFilter] = useState<TalentCategory | "all">("all");
  const [editing, setEditing] = useState<TalentProfile | null>(null);
  const [creating, setCreating] = useState(false);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of profiles) m[p.category] = (m[p.category] ?? 0) + 1;
    return m;
  }, [profiles]);

  const shown = filter === "all" ? profiles : profiles.filter((p) => p.category === filter);

  const del = useMutation({
    mutationFn: (id: string) => api.deleteTalent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["talent"] }),
  });

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-bone-100">
      <StudioLeftRail
        project={railFeatured}
        studioName={studioName}
        logoUrl={config?.logoUrl ?? null}
        ownerName={ownerName}
        ownerTitle={ownerTitle}
        ownerAvatar={owner?.avatarUrl ?? null}
      />

      <main className="pl-[248px]">
        <div className="mx-auto max-w-6xl px-8 py-8">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.28em]" style={gold}>Studio Roster</div>
              <h1 className="mt-1 font-apple text-4xl font-semibold text-bone-50">Talent Directory</h1>
              <p className="mt-1 text-[13px] text-bone-400">Reusable people across every project — writers, co-writers, readers, consultants and crew.</p>
            </div>
            <button
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium text-black"
              style={{ background: GOLD }}
            >
              <Plus className="h-4 w-4" /> Add person
            </button>
          </div>

          {/* category filter */}
          <div className="mt-6 flex flex-wrap gap-2">
            <Chip active={filter === "all"} onClick={() => setFilter("all")} label={`All (${profiles.length})`} />
            {TALENT_CATEGORIES.map((c) => (
              <Chip key={c} active={filter === c} onClick={() => setFilter(c)} label={`${TALENT_CATEGORY_LABELS[c]} (${counts[c] ?? 0})`} />
            ))}
          </div>

          {/* grid */}
          {talentQ.isLoading ? (
            <div className="mt-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-bone-500" /></div>
          ) : shown.length === 0 ? (
            <EmptyState onAdd={() => setCreating(true)} hasAny={profiles.length > 0} />
          ) : (
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((p) => (
                <TalentCard key={p.id} p={p} onEdit={() => setEditing(p)} onDelete={() => del.mutate(p.id)} deleting={del.isPending} />
              ))}
            </div>
          )}
        </div>
      </main>

      {(creating || editing) && (
        <TalentModal
          profile={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["talent"] }); setCreating(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border px-3 py-1 text-[12px] transition-colors"
      style={active ? { borderColor: `${GOLD}88`, color: GOLD, background: "rgba(216,177,90,0.1)" } : { borderColor: "#26262c", color: "#9a927e" }}
    >
      {label}
    </button>
  );
}

function Avatar({ name, url, size }: { name: string; url: string | null; size: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, borderColor: `${GOLD}66` } as React.CSSProperties;
  if (url && !failed) return <img src={url} alt="" onError={() => setFailed(true)} className="rounded-full border object-cover" style={style} />;
  return (
    <div className="grid place-items-center rounded-full border font-apple" style={{ ...style, color: GOLD, background: "rgba(0,0,0,0.5)", fontSize: size * 0.4 }}>
      {(name.trim()[0] ?? "?").toUpperCase()}
    </div>
  );
}

function TalentCard({ p, onEdit, onDelete, deleting }: { p: TalentProfile; onEdit: () => void; onDelete: () => void; deleting: boolean }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="relative rounded-2xl border border-[#26262c] bg-white/[0.015] p-4">
      <div className="flex items-start gap-3">
        <Avatar name={p.name} url={p.avatarUrl} size={48} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] text-bone-50">{p.name}</div>
          <div className="truncate text-[11px]" style={gold}>{TALENT_CATEGORY_LABELS[p.category]}{p.role ? ` · ${p.role}` : ""}</div>
          {p.email && <div className="mt-0.5 flex items-center gap-1 truncate text-[10.5px] text-bone-400"><Mail className="h-3 w-3" /> {p.email}</div>}
        </div>
      </div>
      {p.bio && <p className="mt-2 line-clamp-2 text-[11.5px] text-bone-300">{p.bio}</p>}
      {p.specialties.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {p.specialties.slice(0, 4).map((s) => <span key={s} className="rounded-full border border-[#26262c] px-1.5 py-0.5 text-[9.5px] text-bone-400">{s}</span>)}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between">
        <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ color: "#9a927e", background: "rgba(154,146,126,0.12)" }}>{TALENT_INVITE_LABELS[p.inviteStatus]}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10.5px] text-bone-500">{p.projectHistory.length} project{p.projectHistory.length === 1 ? "" : "s"}</span>
          <button onClick={onEdit} className="rounded-md p-1 text-bone-400 hover:text-bone-100"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={() => setConfirm(true)} className="rounded-md p-1 text-bone-400 hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {confirm && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl bg-black/88 p-4 text-center backdrop-blur-sm">
          <p className="text-[12.5px] text-bone-200">Remove <span className="text-bone-50">{p.name}</span> from the directory?</p>
          <div className="flex gap-2">
            <button onClick={onDelete} disabled={deleting} className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-60">
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Remove
            </button>
            <button onClick={() => setConfirm(false)} className="rounded-lg border border-white/15 px-4 py-1.5 text-[12.5px] text-bone-200 hover:bg-white/5">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onAdd, hasAny }: { onAdd: () => void; hasAny: boolean }) {
  return (
    <div className="mt-10 grid place-items-center rounded-2xl border border-dashed border-[#2c2c33] py-16 text-center">
      <div className="text-[14px] text-bone-300">{hasAny ? "No one in this category yet." : "Your directory is empty."}</div>
      <button onClick={onAdd} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[#d8b15a]/45 px-4 py-2 text-[12.5px]" style={gold}>
        <Plus className="h-4 w-4" /> Add your first person
      </button>
    </div>
  );
}

function TalentModal({ profile, onClose, onSaved }: { profile: TalentProfile | null; onClose: () => void; onSaved: () => void }) {
  const editing = !!profile;
  const [name, setName] = useState(profile?.name ?? "");
  const [email, setEmail] = useState(profile?.email ?? "");
  const [category, setCategory] = useState<TalentCategory>(profile?.category ?? "writer");
  const [role, setRole] = useState(profile?.role ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl ?? "");
  const [specialties, setSpecialties] = useState((profile?.specialties ?? []).join(", "));
  const [credits, setCredits] = useState((profile?.credits ?? []).join(", "));
  const [permission, setPermission] = useState<LivePermission>(profile?.permission ?? "comment");

  const save = useMutation({
    mutationFn: (body: TalentProfileInput) =>
      editing ? api.updateTalent(profile!.id, body) : api.createTalent(body),
    onSuccess: onSaved,
  });

  const input = "w-full rounded-md border border-[#26262c] bg-black/30 px-3 py-2 text-[13px] text-bone-50 placeholder:text-bone-600 focus:border-[#d8b15a]/60 focus:outline-none";
  const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[#d8b15a]/25 bg-[#0b0b0e]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#26262c] px-5 py-3.5">
          <div className="font-apple text-lg text-bone-50">{editing ? "Edit profile" : "Add to directory"}</div>
          <button onClick={onClose} className="text-bone-400 hover:text-bone-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {save.isError && <p className="text-[12px] text-red-300">{(save.error as Error).message}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={input} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className={input} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <select className={input} value={category} onChange={(e) => setCategory(e.target.value as TalentCategory)}>
              {TALENT_CATEGORIES.map((c) => <option key={c} value={c} className="bg-[#0b0b0e]">{TALENT_CATEGORY_LABELS[c]}</option>)}
            </select>
            <input className={input} placeholder="Role — e.g. Staff Writer" value={role} onChange={(e) => setRole(e.target.value)} />
          </div>
          <input className={input} placeholder="Profile photo URL (optional)" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
          <textarea className={input + " min-h-[64px] resize-y"} placeholder="Bio / credits summary" value={bio} onChange={(e) => setBio(e.target.value)} />
          <input className={input} placeholder="Specialties (comma separated)" value={specialties} onChange={(e) => setSpecialties(e.target.value)} />
          <input className={input} placeholder="Credits (comma separated)" value={credits} onChange={(e) => setCredits(e.target.value)} />
          <div>
            <label className="text-[10px] uppercase tracking-wide text-bone-500">Default permission</label>
            <select className={input + " mt-1"} value={permission} onChange={(e) => setPermission(e.target.value as LivePermission)}>
              {LIVE_PERMISSIONS.map((p) => <option key={p} value={p} className="bg-[#0b0b0e]">{LIVE_PERMISSION_LABELS[p]}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#26262c] px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-white/15 px-4 py-2 text-[13px] text-bone-200 hover:bg-white/5">Cancel</button>
          <button
            onClick={() => save.mutate({
              name: name.trim(), email: email.trim() || null, category, role: role.trim() || null,
              avatarUrl: avatarUrl.trim() || null, bio: bio.trim() || null,
              specialties: split(specialties), credits: split(credits), permission,
            })}
            disabled={save.isPending || !name.trim()}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium text-black disabled:opacity-50"
            style={{ background: GOLD }}
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {editing ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
