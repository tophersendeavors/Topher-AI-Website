import DesignCard from "@/components/DesignCard";
import type { StudioApi } from "@/hooks/useDesignStudio";

export default function DailyDesigns({ studio }: { studio: StudioApi }) {
  const today = new Date().toISOString().slice(0, 10);
  // Group designs by `generatedFor` so previous days are still browsable.
  const byDay = new Map<string, typeof studio.designs>();
  for (const d of studio.designs) {
    const list = byDay.get(d.generatedFor) ?? [];
    list.push(d);
    byDay.set(d.generatedFor, list);
  }
  const days = Array.from(byDay.keys()).sort().reverse();

  return (
    <div className="space-y-10">
      <header>
        <div className="label">Auto-generated streetwear concepts</div>
        <h1 className="display-title text-4xl text-ash-bone mt-2 distress">
          Daily Designs
        </h1>
      </header>

      {days.length === 0 && (
        <div className="card p-10 text-center text-ash-gray">
          Nothing yet. Generate the first batch.
          <button
            type="button"
            className="btn-primary ml-4"
            onClick={() => studio.generateToday()}
            disabled={studio.generating}
          >
            Generate today's 5
          </button>
        </div>
      )}

      {days.map((day) => (
        <section key={day}>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="display-title text-xl text-ash-bone">
              {day} {day === today && <span className="label ml-2">today</span>}
            </h2>
            <div className="label">{byDay.get(day)?.length} designs</div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {byDay.get(day)?.map((d) => (
              <DesignCard key={d.id} design={d} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
