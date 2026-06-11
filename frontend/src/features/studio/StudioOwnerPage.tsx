import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Pencil, LogOut } from "lucide-react";
import { STUDIO_ROLE_LABELS, type StudioOwnerResponse } from "@toburt/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { StudioOwnerOnboarding } from "./StudioOwnerOnboarding";

const GOLD = "#d8b15a";

export function StudioOwnerPage() {
  const qc = useQueryClient();
  const { signOut } = useAuth();
  const q = useQuery({ queryKey: ["studio-owner"], queryFn: () => api.getStudioOwner() });
  const save = useMutation({
    mutationFn: (patch: Parameters<typeof api.saveStudioOwner>[0]) => api.saveStudioOwner(patch),
    onSuccess: (r: StudioOwnerResponse) => qc.setQueryData(["studio-owner"], r),
  });
  const [editing, setEditing] = useState(false);
  const owner = q.data?.owner ?? null;

  if (q.isError) {
    return (
      <div className="min-h-screen bg-[#08080a] p-8">
        <div className="mx-auto mt-20 max-w-md rounded-xl border border-red-700/40 bg-red-950/20 p-5 text-center">
          <div className="text-bone-50">Couldn't load your studio</div>
          <p className="mt-2 break-words text-[12px] text-red-200">{(q.error as Error).message}</p>
          <button
            onClick={() => {
              signOut();
              window.location.assign("/sign-in");
            }}
            className="mt-4 rounded-lg px-4 py-2 text-[13px] font-medium text-black"
            style={{ background: GOLD }}
          >
            Sign in again
          </button>
        </div>
      </div>
    );
  }
  if (!owner) return <div className="min-h-screen bg-[#08080a] p-8 text-bone-300">Loading…</div>;

  if (editing) {
    return (
      <StudioOwnerOnboarding
        initial={owner}
        onComplete={async (patch) => {
          await save.mutateAsync(patch);
          setEditing(false);
        }}
      />
    );
  }

  const twin = owner.creativeTwin;
  return (
    <div className="min-h-screen bg-[#08080a] px-8 py-8 text-bone-100">
      <Link to="/studio" className="inline-flex items-center gap-1 text-[12px] text-bone-400 hover:text-bone-100">
        <ChevronLeft className="h-4 w-4" /> Studio Lot
      </Link>

      <div className="mx-auto mt-6 max-w-xl overflow-hidden rounded-2xl border border-[#d8b15a]/25 bg-gradient-to-b from-[#141008] to-[#0b0a08]">
        <div className="flex flex-col items-center px-8 pt-10 pb-8 text-center">
          <div className="grid h-28 w-28 place-items-center overflow-hidden rounded-full border-2" style={{ borderColor: `${GOLD}66` }}>
            {owner.avatarUrl ? (
              <img src={owner.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="font-apple text-5xl" style={{ color: GOLD }}>{(owner.name[0] ?? "T").toUpperCase()}</span>
            )}
          </div>
          <h1 className="mt-4 font-apple text-3xl text-bone-50">{twin?.displayName ?? owner.name}</h1>
          <div className="mt-1 text-[12px] uppercase tracking-[0.22em]" style={{ color: GOLD }}>
            {twin?.titleLine ?? (owner.role ? STUDIO_ROLE_LABELS[owner.role] : "Studio Owner")}
          </div>
          {owner.bio && <p className="mt-4 max-w-md text-[13px] leading-relaxed text-bone-300">{owner.bio}</p>}

          <div className="mt-6 flex items-center gap-2">
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-[13px]"
              style={{ borderColor: `${GOLD}55`, color: GOLD }}
            >
              <Pencil className="h-3.5 w-3.5" /> Edit identity
            </button>
            <button
              onClick={() => signOut()}
              className="inline-flex items-center gap-2 rounded-lg border border-[#26262c] px-4 py-2 text-[13px] text-bone-300 hover:text-bone-100"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </div>
        <div className="border-t border-[#26262c] px-8 py-4 text-center text-[11px] text-bone-500">
          This is your Creative Twin — the face of your studio. It will evolve as you create.
        </div>
      </div>
    </div>
  );
}
