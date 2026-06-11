import { useRef, useState } from "react";
import { Loader2, Camera, Clapperboard } from "lucide-react";
import { STUDIO_ROLE_LABELS, type StudioOwnerIdentity, type StudioRole } from "@toburt/shared";

const GOLD = "#d8b15a";

/** Resize an uploaded image to a small square data URL for user_metadata. */
async function fileToAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL("image/jpeg", 0.85);
}

const ROLES = Object.keys(STUDIO_ROLE_LABELS) as StudioRole[];

export function StudioOwnerOnboarding({
  initial,
  onComplete,
}: {
  initial: StudioOwnerIdentity;
  onComplete: (patch: {
    name: string;
    role: StudioRole | null;
    bio: string;
    avatarUrl: string | null;
    onboardingComplete: boolean;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(initial.name === "chris" ? "" : initial.name);
  const [role, setRole] = useState<StudioRole | null>(initial.role);
  const [bio, setBio] = useState(initial.bio);
  const [avatar, setAvatar] = useState<string | null>(initial.avatarUrl);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const monogram = (name.trim()[0] ?? "T").toUpperCase();
  const canEnter = name.trim().length > 0 && !!role;

  async function enter() {
    setBusy(true);
    try {
      await onComplete({ name: name.trim(), role, bio: bio.trim(), avatarUrl: avatar, onboardingComplete: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#d8b15a]/25 bg-[#0b0b0e] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]">
        <div
          className="px-7 pt-7 pb-5"
          style={{ background: "linear-gradient(180deg, rgba(216,177,90,0.10), transparent)" }}
        >
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.28em]" style={{ color: GOLD }}>
            <Clapperboard className="h-4 w-4" /> Welcome to your studio
          </div>
          <h2 className="mt-2 font-apple text-2xl text-bone-50">Create your Studio Owner identity</h2>
          <p className="mt-1 text-[12.5px] text-bone-300">
            This becomes the face of your studio — your Creative Twin appears throughout the lot.
          </p>
        </div>

        <div className="space-y-4 px-7 pb-7">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => fileRef.current?.click()}
              className="relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full border"
              style={{ borderColor: `${GOLD}66` }}
            >
              {avatar ? (
                <img src={avatar} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="font-apple text-3xl" style={{ color: GOLD }}>{monogram}</span>
              )}
              <span className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-1 bg-black/60 py-0.5 text-[9px] text-bone-200">
                <Camera className="h-2.5 w-2.5" /> Photo
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setAvatar(await fileToAvatar(f));
              }}
            />
            <div className="flex-1">
              <label className="text-[10.5px] uppercase tracking-wide text-bone-500">Your name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Christopher Maretich"
                className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-[14px] text-bone-50 placeholder:text-bone-600 focus:border-[#d8b15a]/60 focus:outline-none"
              />
            </div>
          </div>

          {/* Role */}
          <div>
            <label className="text-[10.5px] uppercase tracking-wide text-bone-500">Your role</label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {ROLES.map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className="rounded-full border px-3 py-1 text-[12px] transition-colors"
                  style={
                    role === r
                      ? { borderColor: GOLD, color: GOLD, background: "rgba(216,177,90,0.10)" }
                      : { borderColor: "rgba(255,255,255,0.12)", color: "#bdb497" }
                  }
                >
                  {STUDIO_ROLE_LABELS[r]}
                </button>
              ))}
            </div>
          </div>

          {/* Bio */}
          <div>
            <label className="text-[10.5px] uppercase tracking-wide text-bone-500">A line about you (optional)</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={2}
              placeholder="What you make, and why."
              className="mt-1 w-full resize-y rounded-md border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-bone-100 placeholder:text-bone-600 focus:border-[#d8b15a]/60 focus:outline-none"
            />
          </div>

          <button
            onClick={enter}
            disabled={!canEnter || busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-[14px] font-medium text-black transition-opacity disabled:opacity-40"
            style={{ background: GOLD }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Enter your studio
          </button>
        </div>
      </div>
    </div>
  );
}
