/**
 * Headless daily-generation entrypoint.
 *
 *   pnpm generate:daily          # runs locally, uses the curated trend pool
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm generate:daily
 *
 * Wire this into GitHub Actions, a Supabase Edge Function, or any cron
 * provider to push a fresh batch of five designs once per day without
 * needing the dashboard to be open.
 */
import { createClient } from "@supabase/supabase-js";

// The browser-flavored generator works in Node 20+ thanks to Web Crypto
// being available globally. We re-implement the few `import.meta.env`
// touch points via process.env so this script doesn't drag Vite in.
process.env.VITE_IMAGE_API_PROVIDER ??= "mock";

// Cheap shim: make `import.meta.env` look like Vite's at runtime.
(globalThis as unknown as { importMetaEnv: NodeJS.ProcessEnv }).importMetaEnv =
  process.env;

// Dynamic import so the `import.meta.env` references inside the lib resolve
// against this script's tsconfig.
const { generateDailyDesigns } = await import("../src/lib/designGenerator");
const { DEFAULT_BRAND_SETTINGS } = await import("../src/types");

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

  const batch = await generateDailyDesigns({
    brand: DEFAULT_BRAND_SETTINGS,
    count: 5,
  });

  if (!url || !key) {
    console.log(
      `Generated ${batch.length} designs. No Supabase credentials, printing summary instead:`,
    );
    for (const d of batch) {
      console.log(`  · ${d.title}  [${d.garmentType}]  seed=${d.artwork.seed}`);
    }
    return;
  }

  const supa = createClient(url, key);
  for (const d of batch) {
    const { error } = await supa.from("designs").upsert({
      id: d.id,
      created_at: d.createdAt,
      generated_for: d.generatedFor,
      title: d.title,
      garment_type: d.garmentType,
      stage: d.stage,
      status: d.status,
      approved: d.approved,
      ready_for_ninja_transfers: d.readyForNinjaTransfers,
      payload: d,
    });
    if (error) {
      console.error("Supabase upsert failed:", error.message);
      process.exitCode = 1;
    }
  }
  console.log(`Pushed ${batch.length} fresh designs to Supabase.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
