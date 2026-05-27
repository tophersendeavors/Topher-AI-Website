import { AGENT_PROFILES, type AgentRole } from "@toburt/shared";
import clsx from "clsx";

export function AgentAvatar({
  role,
  size = 32,
  className,
}: {
  role: AgentRole;
  size?: number;
  className?: string;
}) {
  const p = AGENT_PROFILES[role];
  return (
    <div
      title={p.label}
      className={clsx(
        "grid place-items-center rounded-md font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset]",
        className
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: p.accent,
        boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.10), 0 6px 22px -8px ${p.accent}aa`,
        fontSize: size < 28 ? 11 : 13,
      }}
    >
      {p.emoji}
    </div>
  );
}

export function AgentBadge({ role }: { role: AgentRole }) {
  const p = AGENT_PROFILES[role];
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] py-1 pl-1 pr-2.5 text-xs text-bone-100">
      <AgentAvatar role={role} size={18} />
      {p.label}
    </span>
  );
}
