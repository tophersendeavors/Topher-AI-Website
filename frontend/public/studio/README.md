# Studio Lot assets (drop-in)

UI overlays stay separate from this footage — the app renders its own header,
owner chip, sound-stage markers, and logo ON TOP. Do NOT bake UI/text into
these files.

Background (precedence: per-studio profile → these files → built-in scene):
- `lot.mp4`  — living lot loop (preferred; muted, autoplay, loop). Best from Kling.
- `lot.jpg`  — still fallback if no video.

Logo overlay (precedence: per-studio profile → this file → gold monogram):
- `logo.png` — transparent PNG, ~square. Sits in the top-left brand mark.

Requirements: 16:9 landscape footage, dark golden-hour dusk, NO UI/text baked in.

Per-studio personalization: studioConfig.heroImageUrl / logoUrl override these
defaults once an approved studio identity supplies its own render + mark.
