import { useMemo } from "react";
import type { Design } from "@/types";

interface Props {
  design: Design;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<Props["size"]>, string> = {
  sm: "aspect-[5/6]",
  md: "aspect-[5/6]",
  lg: "aspect-[5/6]",
};

export default function DesignThumb({ design, size = "md", className }: Props) {
  const dataUrl = useMemo(
    () => `data:image/svg+xml;utf8,${encodeURIComponent(design.artwork.svg)}`,
    [design.artwork.svg],
  );
  return (
    <div
      className={`relative overflow-hidden bg-[radial-gradient(circle_at_50%_30%,#1d1d1d_0%,#080808_70%)] border border-white/5 ${SIZE_CLASS[size]} ${className ?? ""}`}
    >
      <img
        src={dataUrl}
        alt={design.title}
        className="absolute inset-0 w-full h-full object-contain p-4 mix-blend-screen"
        loading="lazy"
      />
      <div className="absolute left-2 top-2 chip">{design.garmentType}</div>
      <div className="absolute right-2 top-2 chip">{design.stage}</div>
    </div>
  );
}
