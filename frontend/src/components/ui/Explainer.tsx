// Plain-language explainer. A small "?" button you place next to any
// professional-jargon label. Click → popover with a 1–3 sentence
// explanation from the glossary. Closes on outside-click or Escape.
//
// Usage:
//   <span>Character wound <Explainer id="character_wound" /></span>

import { useEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import { explainerFor, type GlossaryEntry } from "@/lib/glossary";

export function Explainer({
  id,
  /** Optional inline term override — useful when reusing one entry under different labels. */
  inlineTerm,
}: {
  id: string;
  inlineTerm?: string;
}) {
  const entry: GlossaryEntry | null = explainerFor(id);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!entry) return null;
  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-bone-500 hover:text-bone-200"
        title={`What is ${inlineTerm ?? entry.term}?`}
      >
        <HelpCircle className="h-3 w-3" />
      </button>
      {open && (
        <span className="absolute left-5 top-0 z-30 w-72 rounded-md border border-white/10 bg-ink-900 p-3 text-[11px] text-bone-200 shadow-lg">
          <span className="block font-medium text-bone-50">{inlineTerm ?? entry.term}</span>
          <span className="mt-1 block text-bone-300">{entry.description}</span>
        </span>
      )}
    </span>
  );
}
