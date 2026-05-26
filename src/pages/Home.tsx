import { Link } from "react-router-dom";
import DesignCard from "@/components/DesignCard";
import type { StudioApi } from "@/hooks/useDesignStudio";
import { printCheckScore } from "@/lib/printChecker";

export default function Home({ studio }: { studio: StudioApi }) {
  const designs = studio.designs;
  const avgScore =
    designs.length === 0
      ? 0
      : Math.round(
          designs.reduce((acc, d) => acc + printCheckScore(d.printCheck), 0) /
            designs.length,
        );

  const approved = designs.filter((d) => d.approved).length;
  const ninjaReady = designs.filter((d) => d.readyForNinjaTransfers).length;

  return (
    <div className="space-y-10">
      <header className="flex items-start justify-between gap-6">
        <div>
          <div className="label">{new Date().toUTCString().slice(0, 16)}</div>
          <h1 className="display-title text-5xl text-ash-bone distress mt-2">
            The Atelier of Ash
          </h1>
          <p className="text-ash-gray max-w-xl mt-3">
            Five new graphic concepts generated every day from a curated stream
            of streetwear, gothic minimalism, Y2K decay, and runway underground
            signals. Approve, edit, and export print-ready files for Ninja
            Transfers.
          </p>
        </div>
        <Link to="/daily" className="btn-primary">
          Review today's drop
        </Link>
      </header>

      <section className="grid grid-cols-4 gap-3">
        <Stat label="Designs in studio" value={designs.length} />
        <Stat label="Today's batch" value={studio.todayBatch.length} suffix="/ 5" />
        <Stat label="Avg. print score" value={`${avgScore}%`} />
        <Stat label="Approved · Ninja-ready" value={`${approved} · ${ninjaReady}`} />
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="display-title text-2xl text-ash-bone">Today's Drop</h2>
          <Link to="/daily" className="label hover:text-ash-bone">
            View all →
          </Link>
        </div>
        {studio.todayBatch.length === 0 ? (
          <div className="card p-10 text-center text-ash-gray">
            No designs generated yet today.
            <button
              type="button"
              className="btn-primary ml-4"
              onClick={() => studio.generateToday()}
              disabled={studio.generating}
            >
              Generate now
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {studio.todayBatch.map((d) => (
              <DesignCard key={d.id} design={d} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string | number;
  suffix?: string;
}) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className="mt-2 display-title text-3xl text-ash-bone">
        {value}
        {suffix && <span className="text-ash-gray text-lg ml-1">{suffix}</span>}
      </div>
    </div>
  );
}
