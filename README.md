# ASH KROW · Design Studio

Internal dashboard for **ASH KROW** — a dark luxury streetwear label.
Auto-generates five new apparel graphic concepts every day from a curated
stream of streetwear / gothic minimalism / Y2K / vintage tattoo / runway
underground trend signals, then exports print-ready files for Ninja
Transfers (DTF) production.

> Dark luxury streetwear. Minimal but emotionally charged. Distressed
> typography. Gritty but premium. Not cartoonish, not childish, not
> generic AI art.

---

## Features

- **Daily Design Generator** — five fresh concepts every UTC day,
  deterministic per-day seed so a re-run produces the same drop.
- **Print-Ready Export** — transparent PNG at 4500 × 5400px (≈ 15″ × 18″
  @ 300dpi equivalent) plus clean SVG and a JSON manifest.
- **Brand Style Engine** — palette, voice, signature prompt suffix, and
  forbidden-term guardrails baked into every generation.
- **Workflow stages** — concept → prompt → generated → print-check →
  approved → exported.
- **Print Readiness Checker** — eight automated checks per design
  (transparent bg, pixel size, contrast, no thin lines, no tiny details,
  no copyrighted terms, garment-printing suitability, export available).
- **User controls** — regenerate, edit prompt, change garment, change
  palette, save/approve/reject, mark Ninja-ready, add placement notes,
  download PNG/SVG.
- **Supabase persistence** — `designs` and `brand_settings` tables.
  Falls back to `localStorage` if Supabase env vars aren't set.
- **Optional image-gen hook** — wire any provider (Replicate, fal.ai,
  OpenAI, Stability…) via `VITE_IMAGE_API_*` envs. When unset the studio
  uses the procedural SVG generator built in.

---

## Tech stack

- **React 18 + TypeScript**
- **Vite 5** dev server / build
- **Tailwind CSS 3** with an ASH KROW palette (black / bone / ash gray /
  faded white / blood red / chrome / washed denim blue)
- **React Router 6**
- **Supabase JS** for saved designs
- **tsx** for the headless daily cron script

---

## Run it locally

```bash
# 1. Install
npm install

# 2. Copy envs (everything is optional — the app runs fully without them)
cp .env.example .env.local
# fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY if you want persistence
# add VITE_IMAGE_API_* if you want real image generation

# 3. Dev server
npm run dev
# → http://localhost:5173

# 4. Type-check + build
npm run build
```

If you open the app with no Supabase credentials, it stores everything in
`localStorage` — useful for offline ideation.

---

## Connect Supabase

1. Create a project at <https://supabase.com>.
2. Open the SQL editor and paste `supabase/schema.sql`.
3. In *Project Settings → API* grab the **URL** and **anon public key**.
4. Add them to `.env.local`:

   ```bash
   VITE_SUPABASE_URL=https://<project>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon-key>
   ```

5. Restart `npm run dev`. The sidebar status will flip from
   `local-only` → `connected`.

Row-level security is enabled with permissive `authenticated` policies in
the shipped schema. Lock them down further before going to production
(see comments in `supabase/schema.sql`).

---

## Connect an image-generation API

Image generation is opt-in. The procedural SVG generator already produces
production-quality, transparent, distressed graphic prints, so plug an
external model in only if you want photoreal renders.

In `.env.local`:

```bash
VITE_IMAGE_API_PROVIDER=replicate   # any non-"mock" value enables the hook
VITE_IMAGE_API_URL=https://api.replicate.com/v1/predictions
VITE_IMAGE_API_KEY=<your-key>
VITE_IMAGE_API_MODEL=stability-ai/sdxl
```

The hook lives in `src/lib/designGenerator.ts` → `tryRemoteImageGen()` —
adjust the request body shape to match your provider. When the call
succeeds the returned image URL or base64 is stored on
`design.artwork.pngDataUrl` and shown alongside the SVG.

**Never** commit real keys. The repo's `.gitignore` blocks `.env*`.

---

## Daily generation trigger

Three options, pick whichever fits your stack:

1. **In-app** (default): when the dashboard is open it generates today's
   batch the first time it boots and reschedules a fresh batch at the
   next UTC midnight. Click *Regenerate today* to force-refresh.

2. **Headless cron** (recommended for production):

   ```bash
   SUPABASE_URL=...           \
   SUPABASE_SERVICE_ROLE_KEY=... \
   npm run generate:daily
   ```

   Wire this into GitHub Actions, Render Cron, fly.io cron, or a
   Supabase Edge Function. Example GH Actions stub:

   ```yaml
   on:
     schedule: [{ cron: "0 7 * * *" }]   # 07:00 UTC daily
   jobs:
     drop:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: 20 }
         - run: npm ci && npm run generate:daily
           env:
             SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
             SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
   ```

3. **Supabase Edge Function** — port `scripts/generateDaily.ts` into a
   Deno function and trigger via `pg_cron`. The generator is pure JS, so
   it runs anywhere with Web Crypto.

---

## Exporting print-ready files

Each design supports three exports from both the detail page and the
**Export** page:

- **PNG** — rasterizes the SVG into a 4500 × 5400 transparent canvas
  (`src/lib/exporter.ts → exportPng`).
- **SVG** — the raw `<svg>` markup with `data-transparent="true"` and
  clean vector paths. Type uses system fonts; convert to outlines in
  Illustrator / Inkscape if your printer requires it.
- **JSON manifest** — title, garment, placement, print size, prompt,
  palette, heat-transfer notes. Hand this to your production team along
  with the PNG.

The PNG exports are already at 4500px wide, transparent, and have no
mockup/garment in the frame — the exact spec Ninja Transfers DTF uploads
ask for.

---

## File map

```
src/
├── App.tsx                       # router root
├── main.tsx                      # entry
├── index.css                     # Tailwind + ASH KROW design tokens
├── components/
│   ├── Layout.tsx                # sidebar + top bar shell
│   ├── DesignCard.tsx
│   ├── DesignThumb.tsx
│   ├── PrintReadinessChecklist.tsx
│   └── StageRail.tsx
├── pages/
│   ├── Home.tsx                  # dashboard
│   ├── DailyDesigns.tsx          # 5/day + day archive
│   ├── DesignDetail.tsx          # full controls + exports
│   ├── SavedLibrary.tsx
│   ├── ExportPage.tsx
│   ├── BrandSettings.tsx
│   └── PromptEditor.tsx
├── hooks/
│   └── useDesignStudio.ts        # state, persistence, daily scheduler
├── lib/
│   ├── designGenerator.ts        # procedural SVG + optional remote hook
│   ├── trendResearch.ts          # curated + remote trend signal pool
│   ├── printChecker.ts           # 8-point readiness checklist
│   ├── exporter.ts               # PNG / SVG / manifest downloads
│   ├── store.ts                  # Supabase + localStorage adapter
│   ├── supabase.ts               # client w/ graceful fallback
│   └── mockData.ts
├── types/index.ts                # Design, BrandSettings, enums
└── vite-env.d.ts
scripts/
└── generateDaily.ts              # headless cron entrypoint
supabase/
└── schema.sql                    # designs + brand_settings tables
```

---

## Originality & legal

The generator never embeds celebrity likenesses, existing band logos,
existing fashion brand wordmarks, or trademarked phrases. The brand-level
**Forbidden Terms** list (editable in *Brand Settings*) is matched
against every design's title and prompt — any hit fails the
`noCopyrightedTerms` print-readiness check and blocks export by default.
The shipped defaults block competitor names (Nike, Chrome Hearts,
Balenciaga, Vetements, Rick Owens, Supreme, Off-White, Fear of God, LV,
Gucci, Yeezy, Travis Scott, Kanye, Drake) — edit the list to match your
own legal review.
