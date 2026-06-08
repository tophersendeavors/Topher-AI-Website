// Canon Target Picker (Stage 5 step A).
//
// Replaces the freetext canonFieldPath input. Cascading dropdowns
// pulled from /projects/:id/canon-catalog. The user picks
// Location → Category → Item; the underlying database path stays
// invisible. After picking, the user can either:
//   • Attach this contribution as a REFERENCE for the picked target
//   • Also REPLACE the prose canon with explicit text (override)
//
// Returns its resolved field path + optional override text to the parent.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { api, type CanonCatalogEntry } from "@/lib/api";

interface Props {
  projectId: string;
  /** Optional filter — when the picker is opened inside a specific
   *  department's workspace, only show fields that department owns. */
  filterDepartmentKey?: string;
  /** Selected field path. Empty string when the user has not picked yet. */
  fieldPath: string;
  /** Optional explicit-text override (becomes canonOverrideText on approval). */
  canonOverrideText: string;
  onChange: (next: { fieldPath: string; canonOverrideText: string }) => void;
}

export function CanonTargetPicker(props: Props) {
  const { projectId, filterDepartmentKey, fieldPath, canonOverrideText, onChange } = props;
  const catalogQ = useQuery({
    queryKey: ["canon-catalog", projectId],
    queryFn: () => api.getCanonCatalog(projectId),
  });

  const all = useMemo<CanonCatalogEntry[]>(
    () =>
      (catalogQ.data?.entries ?? []).filter(
        (e) => !filterDepartmentKey || e.ownerDepartmentKey === filterDepartmentKey
      ),
    [catalogQ.data, filterDepartmentKey]
  );

  // Hydrate dropdown selection from current fieldPath.
  const initialEntry = all.find((e) => e.fieldPath === fieldPath);
  const [location, setLocation] = useState<string>(initialEntry?.location ?? "");
  const [category, setCategory] = useState<string>(initialEntry?.category ?? "");
  const [item, setItem] = useState<string>(initialEntry?.item ?? "");
  const [field, setField] = useState<string>(initialEntry?.field ?? "");

  // Whenever the catalog or the existing fieldPath value changes, sync the
  // local dropdown state — so opening an existing draft contribution
  // pre-selects the right options.
  useEffect(() => {
    const entry = all.find((e) => e.fieldPath === fieldPath);
    if (entry) {
      setLocation(entry.location ?? "");
      setCategory(entry.category);
      setItem(entry.item);
      setField(entry.field);
    }
  }, [fieldPath, all]);

  const locations = useMemo(
    () => Array.from(new Set(all.map((e) => e.location ?? "Characters"))).sort(),
    [all]
  );
  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          all
            .filter((e) => (location ? (e.location ?? "Characters") === location : true))
            .map((e) => e.category)
        )
      ).sort(),
    [all, location]
  );
  const items = useMemo(
    () =>
      Array.from(
        new Set(
          all
            .filter(
              (e) =>
                (location ? (e.location ?? "Characters") === location : true) &&
                (category ? e.category === category : true)
            )
            .map((e) => e.item)
        )
      ).sort(),
    [all, location, category]
  );
  const fields = useMemo(
    () =>
      all.filter(
        (e) =>
          (location ? (e.location ?? "Characters") === location : true) &&
          (category ? e.category === category : true) &&
          (item ? e.item === item : true)
      ),
    [all, location, category, item]
  );

  // When the user finishes picking, push the underlying path up.
  useEffect(() => {
    const match = fields.find((e) => e.field === field);
    if (match && match.fieldPath !== fieldPath) {
      onChange({ fieldPath: match.fieldPath, canonOverrideText });
    }
  }, [field, fields]);

  const matchedEntry = fields.find((e) => e.field === field);

  if (catalogQ.isLoading) {
    return (
      <div className="text-xs text-bone-400">
        <Loader2 className="inline animate-spin h-3 w-3 mr-1" /> Loading canon catalog…
      </div>
    );
  }
  if (catalogQ.error) {
    return (
      <div className="text-xs text-red-300">
        Failed to load canon catalog: {(catalogQ.error as Error).message}
      </div>
    );
  }

  const selectCls =
    "w-full rounded border border-white/10 bg-white/[0.04] text-bone-100 px-2 py-1 text-xs";

  return (
    <div className="space-y-2 text-xs">
      <div className="text-[10px] uppercase tracking-wide text-bone-400">
        What is this reference for?
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <label className="block">
          <span className="text-[10px] text-bone-500">Location</span>
          <select
            className={selectCls}
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              setCategory("");
              setItem("");
              setField("");
            }}
          >
            <option value="">— pick —</option>
            {locations.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-[10px] text-bone-500">Category</span>
          <select
            className={selectCls}
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setItem("");
              setField("");
            }}
            disabled={!location}
          >
            <option value="">— pick —</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-[10px] text-bone-500">Item</span>
          <select
            className={selectCls}
            value={item}
            onChange={(e) => {
              setItem(e.target.value);
              setField("");
            }}
            disabled={!category}
          >
            <option value="">— pick —</option>
            {items.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-[10px] text-bone-500">Detail</span>
          <select
            className={selectCls}
            value={field}
            onChange={(e) => setField(e.target.value)}
            disabled={!item}
          >
            <option value="">— pick —</option>
            {fields.map((f) => (
              <option key={f.fieldPath} value={f.field}>
                {f.field}
                {f.hasApprovedCanon ? " ✓" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* When a field is picked, show current value + approval state. */}
      {matchedEntry && (
        <div className="rounded border border-white/8 bg-white/[0.03] px-2 py-1.5 space-y-1">
          <div className="flex items-center gap-1.5">
            {matchedEntry.hasApprovedCanon ? (
              <span className="text-[10px] inline-flex items-center gap-0.5 rounded-full bg-emerald-900/40 text-emerald-200 ring-1 ring-emerald-700/40 px-1.5 py-0.5">
                <Check size={10} /> Has approved canon
              </span>
            ) : (
              <span className="text-[10px] rounded-full bg-amber-900/30 text-amber-200 ring-1 ring-amber-700/40 px-1.5 py-0.5">
                No approved canon yet
              </span>
            )}
            <span className="text-[10px] text-bone-500">
              Owner: {humanizeDept(matchedEntry.ownerDepartmentKey)}
            </span>
          </div>
          {matchedEntry.description && (
            <div className="text-[11px] text-bone-300">{matchedEntry.description}</div>
          )}
          {matchedEntry.currentValue && (
            <div className="text-[11px] text-bone-400">
              <span className="text-bone-500">Currently:</span>{" "}
              <span className="line-clamp-2">{matchedEntry.currentValue}</span>
            </div>
          )}
        </div>
      )}

      {matchedEntry && (
        <div className="border-t border-white/8 pt-2 space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-bone-400">
            How do you want this used?
          </div>
          <label className="flex items-start gap-2 text-[11px] text-bone-300 cursor-pointer">
            <input
              type="radio"
              name={`mode-${matchedEntry.fieldPath}`}
              checked={!canonOverrideText.trim()}
              onChange={() =>
                onChange({ fieldPath: matchedEntry.fieldPath, canonOverrideText: "" })
              }
              className="mt-1"
            />
            <span>
              <strong className="text-bone-100">Reference only.</strong> Attach this
              image / URL / color as a canon reference for {matchedEntry.item}{" "}
              {matchedEntry.field.toLowerCase()}. The prose canon stays as-is.
            </span>
          </label>
          <label className="flex items-start gap-2 text-[11px] text-bone-300 cursor-pointer">
            <input
              type="radio"
              name={`mode-${matchedEntry.fieldPath}`}
              checked={!!canonOverrideText.trim()}
              onChange={() =>
                onChange({
                  fieldPath: matchedEntry.fieldPath,
                  canonOverrideText: matchedEntry.currentValue ?? "",
                })
              }
              className="mt-1"
            />
            <span>
              <strong className="text-bone-100">Replace the prose canon</strong> with
              the exact text below. (Prompt body will use this verbatim.)
            </span>
          </label>
          {canonOverrideText.trim() && (
            <textarea
              value={canonOverrideText}
              onChange={(e) =>
                onChange({
                  fieldPath: matchedEntry.fieldPath,
                  canonOverrideText: e.target.value,
                })
              }
              rows={3}
              placeholder="Exact prose the prompt should use for this item."
              className="w-full rounded border border-white/10 bg-white/[0.04] text-bone-100 px-2 py-1 text-xs"
            />
          )}
        </div>
      )}
    </div>
  );
}

function humanizeDept(key: string): string {
  const m: Record<string, string> = {
    production_design: "Production Designer",
    art_dept: "Art Director / Set Decorator",
    props: "Propmaster",
    wardrobe_hmu: "Wardrobe / HMU",
  };
  return m[key] ?? key;
}
