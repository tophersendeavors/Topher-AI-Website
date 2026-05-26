import { useState } from "react";
import DesignCard from "@/components/DesignCard";
import type { StudioApi } from "@/hooks/useDesignStudio";
import { GARMENT_TYPES, type GarmentType } from "@/types";

type Filter = "all" | "approved" | "ninja";

export default function SavedLibrary({ studio }: { studio: StudioApi }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [garmentFilter, setGarmentFilter] = useState<GarmentType | "">("");

  const filtered = studio.savedLibrary.filter((d) => {
    if (filter === "approved" && !d.approved) return false;
    if (filter === "ninja" && !d.readyForNinjaTransfers) return false;
    if (garmentFilter && d.garmentType !== garmentFilter) return false;
    return true;
  });

  return (
    <div className="space-y-8">
      <header>
        <div className="label">{studio.savedLibrary.length} saved</div>
        <h1 className="display-title text-4xl text-ash-bone mt-2 distress">
          Saved Library
        </h1>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(["all", "approved", "ninja"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`btn ${filter === f ? "border-ash-bone text-ash-bone" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <select
          className="input max-w-[200px]"
          value={garmentFilter}
          onChange={(e) => setGarmentFilter(e.target.value as GarmentType | "")}
        >
          <option value="">All garments</option>
          {GARMENT_TYPES.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-10 text-center text-ash-gray">
          Nothing saved yet. Approve or save designs from the daily page.
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {filtered.map((d) => (
            <DesignCard key={d.id} design={d} />
          ))}
        </div>
      )}
    </div>
  );
}
