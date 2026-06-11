import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  Users,
  Palette,
  Clapperboard,
  Film,
  Share2,
  ChevronRight,
} from "lucide-react";
import type { Project, StudioOwnerResponse, StudioRole } from "@toburt/shared";
import { api } from "@/lib/api";
import { StudioOwnerOnboarding } from "./StudioOwnerOnboarding";

const GOLD = "#d8b15a";
const gold = { color: GOLD };

/** Curated marker positions on the lot (desktop). Projects cycle through. */
const LOT_SPOTS = [
  { top: "26%", left: "16%" },
  { top: "30%", left: "70%" },
  { top: "44%", left: "38%" },
  { top: "37%", left: "85%" },
  { top: "57%", left: "20%" },
  { top: "50%", left: "62%" },
  { top: "63%", left: "44%" },
  { top: "33%", left: "49%" },
];

export function StudioLotHome() {
  const qc = useQueryClient();
  const ownerQ = useQuery({ queryKey: ["studio-owner"], queryFn: () => api.getStudioOwner() });
  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: () => api.listProjects() });
  const configQ = useQuery({ queryKey: ["studio-config"], queryFn: () => api.getStudioConfig() });
  const save = useMutation({
    mutationFn: (patch: Parameters<typeof api.saveStudioOwner>[0]) => api.saveStudioOwner(patch),
    onSuccess: (r: StudioOwnerResponse) => qc.setQueryData(["studio-owner"], r),
  });

  const owner = ownerQ.data?.owner ?? null;
  const projects = (projectsQ.data ?? []).filter((p) => p.status !== "archived");
  const inProduction = projects.filter((p) => p.status === "production").length;
  const config = configQ.data?.config ?? null;
  const approvedStudio = config?.concepts.find((c) => c.id === config?.approvedConceptId) ?? null;
  // Per-studio asset precedence: approved-studio profile → dropped-in static
  // file → built-in fallback. (config.heroImageUrl / config.logoUrl are the
  // future personalization hooks, set per approved studio identity.)
  const heroImage = config?.heroImageUrl ?? null;
  const logoUrl = config?.logoUrl ?? null;

  if (owner && !owner.onboardingComplete) {
    return (
      <StudioOwnerOnboarding initial={owner} onComplete={async (patch) => { await save.mutateAsync(patch); }} />
    );
  }

  const studioName = approvedStudio?.name ?? "TOBURT STUDIOS";
  const tagline = approvedStudio?.tagline ?? "Where imagination becomes legacy.";
  const ownerName = owner?.name && owner.name !== "chris" ? owner.name : "Studio Owner";

  return (
    <div className="relative h-screen w-full overflow-hidden bg-black">
      {/* ===== The lot itself — a place, not a page ===== */}
      <LotEnvironment image={heroImage} studioName={studioName} />

      {/* ===== Arrival header (overlaid on the lot) ===== */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-5">
        <div className="pointer-events-auto flex items-center gap-2.5 rounded-lg bg-black/30 px-3 py-1.5 backdrop-blur-sm">
          <StudioLogo logoUrl={logoUrl} name={studioName} />
          <div>
            <div className="font-apple text-lg tracking-[0.15em] text-bone-50">{studioName}</div>
            <div className="text-[9px] uppercase tracking-[0.3em]" style={gold}>{owner?.creativeTwin ? "Your studio" : "Studio Lot"}</div>
          </div>
        </div>

        <div className="pointer-events-auto text-center">
          <div className="font-apple text-[26px] text-bone-50 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
            Welcome back, <span style={gold}>{ownerName}</span>
          </div>
          <div className="text-[12px] text-bone-300">{tagline}</div>
        </div>

        <div className="pointer-events-auto flex items-center gap-3">
          <div className="hidden items-center gap-4 rounded-lg bg-black/30 px-3 py-1.5 backdrop-blur-sm sm:flex">
            <Stat label="On the lot" value={projects.length} />
            <Stat label="Shooting" value={inProduction} />
          </div>
          <OwnerChip name={ownerName} role={owner?.role ?? null} avatarUrl={owner?.avatarUrl ?? null} title={owner?.creativeTwin?.titleLine} />
        </div>
      </div>

      {/* ===== Sound stages standing on the lot ===== */}
      <div className="absolute inset-0 z-10">
        {projects.length === 0 ? (
          <EmptyLot hasStudio={!!approvedStudio} />
        ) : (
          projects.slice(0, LOT_SPOTS.length).map((p, i) => (
            <SoundStageMarker key={p.id} project={p} index={i + 1} spot={LOT_SPOTS[i]} />
          ))
        )}
        {/* overflow stages, if more than the lot has marked spots */}
        {projects.length > LOT_SPOTS.length && (
          <div className="absolute bottom-28 left-1/2 z-20 -translate-x-1/2 text-[11px] text-bone-400">
            +{projects.length - LOT_SPOTS.length} more stages — <Link to="/projects" className="underline" style={gold}>see all</Link>
          </div>
        )}
      </div>

      {/* ===== Design-your-studio prompt (until a studio is built) ===== */}
      {!approvedStudio && (
        <Link
          to="/studio/build"
          className="absolute left-1/2 top-[16%] z-20 -translate-x-1/2 rounded-full border px-4 py-1.5 text-[12px] backdrop-blur-sm"
          style={{ borderColor: `${GOLD}66`, color: GOLD, background: "rgba(0,0,0,0.35)" }}
        >
          <Sparkles className="mr-1.5 inline h-3.5 w-3.5" /> Design your own studio
        </Link>
      )}

      {/* ===== Enter the studio — the rooms (walk inside) ===== */}
      <EnterTheStudio featuredId={projects[0]?.id ?? null} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The environment — full-bleed cinematic lot. Uses the generated render when
// present; otherwise a layered golden-hour dusk scene so it still reads as a
// PLACE (gates, hills, water tower, haze), never a dashboard.
// ---------------------------------------------------------------------------

function LotEnvironment({ image, studioName }: { image: string | null; studioName: string }) {
  // Drop a Kling/any render into frontend/public/studio/ as lot.mp4 (living
  // lot) or lot.jpg (still). It overlays the CSS scene; if absent, onError
  // falls back so the lot is never blank.
  const [videoFailed, setVideoFailed] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const overlayGrad = (
    <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.45), transparent 30%, rgba(0,0,0,0.25) 70%, rgba(0,0,0,0.78))" }} />
  );

  return (
    <div className="absolute inset-0">
      {/* base scene — always present so there is never a blank lot */}
      <CssLot studioName={studioName} />

      {/* preferred: a stored render (per-studio) */}
      {image && !imgFailed && (
        <>
          <img src={image} alt="" onError={() => setImgFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
          {overlayGrad}
        </>
      )}

      {/* else: a dropped-in living lot video, then a still */}
      {!image && !videoFailed && (
        <>
          <video
            src="/studio/lot.mp4"
            autoPlay
            muted
            loop
            playsInline
            onError={() => setVideoFailed(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
          {overlayGrad}
        </>
      )}
      {!image && videoFailed && !imgFailed && (
        <>
          <img src="/studio/lot.png" alt="" onError={() => setImgFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
          {overlayGrad}
        </>
      )}
    </div>
  );
}

function CssLot({ studioName }: { studioName: string }) {
  return (
    <div className="absolute inset-0">
      {/* sky → dusk → ground */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, #0a0b10 0%, #1a140c 42%, #2a1c0e 56%, #120c08 78%, #08060a 100%)" }} />
      {/* sunset glow on the horizon */}
      <div className="absolute inset-0" style={{ background: "radial-gradient(60% 40% at 50% 56%, rgba(216,177,90,0.42), rgba(216,140,60,0.12) 40%, transparent 70%)" }} />
      {/* atmospheric haze */}
      <div className="absolute inset-0" style={{ background: "radial-gradient(120% 70% at 50% 100%, rgba(216,177,90,0.10), transparent 60%)" }} />
      {/* silhouette skyline */}
      <svg className="absolute inset-x-0 bottom-0 h-[52%] w-full" preserveAspectRatio="none" viewBox="0 0 1440 420" aria-hidden>
        {/* far hills */}
        <path d="M0 210 Q 360 150 720 200 T 1440 190 L1440 420 L0 420 Z" fill="#160f09" opacity="0.9" />
        {/* mid buildings band */}
        <path d="M0 300 L120 300 130 268 200 268 210 300 360 300 360 256 470 256 470 300 1440 300 1440 420 0 420 Z" fill="#0d0a07" />
        {/* water tower */}
        <g fill="#0b0805">
          <rect x="250" y="120" width="6" height="90" />
          <rect x="284" y="120" width="6" height="90" />
          <path d="M236 120 h70 l-10 -28 h-50 z" />
        </g>
        <circle cx="271" cy="100" r="10" fill="none" stroke={GOLD} strokeOpacity="0.5" strokeWidth="1.5" />
        {/* central entrance arch */}
        <g>
          <path d="M650 300 v-70 a90 70 0 0 1 180 0 v70 z" fill="#0a0705" stroke={GOLD} strokeOpacity="0.35" strokeWidth="2" />
          <rect x="690" y="262" width="100" height="38" fill="#06040a" />
        </g>
        {/* scattered lit windows */}
        {Array.from({ length: 60 }).map((_, i) => {
          const x = (i * 137) % 1440;
          const y = 270 + ((i * 53) % 120);
          return <rect key={i} x={x} y={y} width="3" height="3" fill={GOLD} opacity={0.25 + ((i % 5) * 0.12)} />;
        })}
      </svg>
      {/* studio name on the arch */}
      <div className="absolute left-1/2 top-[58%] -translate-x-1/2 text-center">
        <div className="font-apple text-2xl tracking-[0.22em] drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]" style={gold}>
          {studioName}
        </div>
      </div>
      {/* vignette */}
      <div className="absolute inset-0" style={{ boxShadow: "inset 0 0 200px 60px rgba(0,0,0,0.8)" }} />
    </div>
  );
}

// Logo is an OVERLAY asset, never baked into the lot footage. Precedence:
// per-studio config.logoUrl → dropped-in /studio/logo.png → gold monogram.
function StudioLogo({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const src = logoUrl ?? "/studio/logo.png";
  if (failed) {
    return (
      <div className="grid h-9 w-9 place-items-center rounded-md border font-apple text-lg" style={{ borderColor: `${GOLD}66`, color: GOLD }}>
        {(name.trim()[0] ?? "T").toUpperCase()}
      </div>
    );
  }
  return <img src={src} alt="" onError={() => setFailed(true)} className="h-9 w-9 object-contain" />;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="font-apple text-xl" style={gold}>{value}</div>
      <div className="text-[8.5px] uppercase tracking-wide text-bone-500">{label}</div>
    </div>
  );
}

function OwnerChip({ name, role, avatarUrl, title }: { name: string; role: StudioRole | null; avatarUrl: string | null; title?: string }) {
  void role;
  return (
    <Link to="/studio/owner" className="flex items-center gap-2.5 rounded-xl border border-[#d8b15a]/30 bg-black/40 px-3 py-1.5 backdrop-blur-sm hover:border-[#d8b15a]/60">
      <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-full border" style={{ borderColor: `${GOLD}66` }}>
        {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : <span className="font-apple" style={gold}>{name[0]}</span>}
      </div>
      <div className="hidden leading-tight md:block">
        <div className="text-[12px] text-bone-50">{name}</div>
        <div className="text-[9px] uppercase tracking-wide text-bone-500">{title ?? "Studio Owner"}</div>
      </div>
    </Link>
  );
}

const STATUS_HUE: Record<Project["status"], string> = {
  ideation: "#9a9aa6",
  development: "#6aa3d8",
  draft: "#d8b15a",
  production: "#6ad88f",
  archived: "#555",
};

function SoundStageMarker({ project, index, spot }: { project: Project; index: number; spot: { top: string; left: string } }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="group absolute z-10 -translate-x-1/2 -translate-y-1/2"
      style={{ top: spot.top, left: spot.left }}
    >
      {/* light pin */}
      <div className="mx-auto mb-1 h-2 w-2 rounded-full" style={{ background: GOLD, boxShadow: `0 0 14px 3px ${GOLD}` }} />
      <div className="min-w-[150px] rounded-lg border border-[#d8b15a]/30 bg-black/55 px-3 py-2 text-center backdrop-blur-sm transition-all group-hover:-translate-y-0.5 group-hover:border-[#d8b15a]/70 group-hover:bg-black/70">
        <div className="text-[8.5px] uppercase tracking-[0.2em] text-bone-500">Sound Stage {index}</div>
        <div className="font-apple text-[15px] leading-tight text-bone-50">{project.title}</div>
        <div className="mt-0.5 inline-flex items-center gap-1 text-[9.5px]" style={{ color: STATUS_HUE[project.status] }}>
          ● {project.status}
        </div>
        <div className="mt-1 flex items-center justify-center gap-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100" style={gold}>
          Enter stage <ChevronRight className="h-3 w-3" />
        </div>
      </div>
    </Link>
  );
}

// `slug` is the room's image filename in /studio/rooms/<slug>.png.
const ROOMS = [
  { label: "Writers Room", sub: "Develop Stories", Icon: Sparkles, path: "writers-room", slug: "writers-room" },
  { label: "Character Dept.", sub: "Build Legends", Icon: Users, path: "character-bible", slug: "character-dept" },
  { label: "Art Department", sub: "Create Worlds", Icon: Palette, path: "production", slug: "art-department" },
  { label: "Production", sub: "Bring to Life", Icon: Clapperboard, path: "episodes", slug: "production" },
  { label: "Post Production", sub: "Shape the Cut", Icon: Film, path: "production", slug: "post-production" },
  { label: "Distribution", sub: "Share the Story", Icon: Share2, path: "exports", slug: "distribution" },
];

function EnterTheStudio({ featuredId }: { featuredId: string | null }) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-20">
      <div className="mx-auto max-w-6xl px-5 pb-4">
        <div
          className="rounded-2xl border border-white/10 bg-black/45 p-3 backdrop-blur-xl"
          style={{ boxShadow: "0 -10px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)" }}
        >
          <div className="mb-2 flex items-center gap-2 px-0.5">
            <span className="text-[10px] uppercase tracking-[0.3em]" style={gold}>Explore the Studio</span>
            <span className="text-[10px] text-bone-500">— walk inside</span>
          </div>
          <div className="flex items-stretch gap-2.5 overflow-x-auto px-1 py-1.5">
            {ROOMS.map((r) => (
              <RoomImageCard key={r.label} room={r} to={featuredId ? `/projects/${featuredId}/${r.path}` : "/projects"} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RoomImageCard({ room, to }: { room: (typeof ROOMS)[number]; to: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <Link
      to={to}
      className="group flex min-w-[150px] flex-1 flex-col overflow-hidden rounded-xl border border-[#26262c] bg-white/[0.015] transition-all duration-200 hover:scale-[1.04] hover:border-[#d8b15a]/60 hover:bg-white/[0.05] hover:shadow-[0_0_28px_rgba(216,177,90,0.28)]"
    >
      {/* image (3:2) — text lives BELOW it, never over it */}
      <div className="aspect-[3/2] w-full overflow-hidden">
        {!failed ? (
          <img
            src={`/studio/rooms/${room.slug}.png`}
            alt={room.label}
            onError={() => setFailed(true)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 group-hover:brightness-110"
          />
        ) : (
          // Placeholder until the room image is dropped in.
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-1"
            style={{ background: "linear-gradient(180deg, #1c150d, #0b0a08)" }}
          >
            <room.Icon className="h-6 w-6 opacity-50" style={gold} />
            <span className="text-[8.5px] uppercase tracking-wide text-bone-600">image</span>
          </div>
        )}
      </div>
      {/* centered label band */}
      <div className="px-2 py-2.5 text-center">
        <div className="text-[14px] font-semibold leading-tight text-bone-50">{room.label}</div>
        <div className="mt-0.5 text-[10.5px] leading-tight" style={gold}>{room.sub}</div>
      </div>
    </Link>
  );
}

function EmptyLot({ hasStudio }: { hasStudio: boolean }) {
  return (
    <div className="absolute left-1/2 top-[42%] z-20 w-[min(90vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[#d8b15a]/25 bg-black/55 p-7 text-center backdrop-blur-sm">
      <div className="font-apple text-2xl text-bone-50">Your lot is dark</div>
      <p className="mx-auto mt-1.5 text-[12.5px] text-bone-300">
        Every production lights a sound stage. Open your first one and the lot comes alive.
      </p>
      <Link
        to="/projects"
        className="mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium text-black"
        style={{ background: GOLD }}
      >
        {hasStudio ? "Light your first stage" : "Open your first stage"}
      </Link>
    </div>
  );
}
