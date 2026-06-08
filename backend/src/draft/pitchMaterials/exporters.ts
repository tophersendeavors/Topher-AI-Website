// Pitch Materials exporters — markdown / plain-text outline / HTML / PDF.
// PPTX is intentionally deferred: shipping a real .pptx needs a dedicated
// dependency (pptxgenjs) — we surface "Coming soon" in the UI rather than
// generate a broken file.

import type { PitchDeck } from "./types.js";
import { DECK_KIND_LABEL, SOURCE_FIELD_LABEL } from "./types.js";

export type PitchFormat = "pdf" | "markdown" | "html" | "text";

const KIND_FOOTER =
  "AI-assisted cinematic production pipeline under showrunner control.";

// --- Markdown ----------------------------------------------------------------

export function exportMarkdown(deck: PitchDeck): string {
  const lines: string[] = [];
  lines.push(`# ${deck.title}`);
  lines.push(`*${DECK_KIND_LABEL[deck.kind]} · ${deck.currentVersionLabel}*`);
  lines.push("");
  for (const s of deck.slides) {
    lines.push(`## ${s.title}`);
    if (s.copy) lines.push(s.copy);
    if (s.missingSources.length) {
      lines.push("");
      lines.push(
        `> **Missing source data:** ${s.missingSources
          .map((m) => SOURCE_FIELD_LABEL[m] ?? m)
          .join(", ")}`
      );
    }
    if (s.visualDirection) {
      lines.push("");
      lines.push(`*Visual direction:* ${s.visualDirection}`);
    }
    if (s.imagePrompt) {
      lines.push("");
      lines.push(`*Image prompt:* \`${s.imagePrompt}\``);
    }
    if (s.speakerNotes) {
      lines.push("");
      lines.push(`*Speaker notes:* ${s.speakerNotes}`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push(KIND_FOOTER);
  return lines.join("\n");
}

// --- Plain-text outline ------------------------------------------------------

export function exportText(deck: PitchDeck): string {
  const lines: string[] = [];
  lines.push(deck.title.toUpperCase());
  lines.push(`${DECK_KIND_LABEL[deck.kind]} · ${deck.currentVersionLabel}`);
  lines.push("");
  let i = 1;
  for (const s of deck.slides) {
    lines.push(`${String(i).padStart(2, "0")}. ${s.title}`);
    if (s.copy) {
      for (const ln of s.copy.split("\n")) lines.push(`    ${ln}`);
    }
    if (s.missingSources.length) {
      lines.push(
        `    [missing: ${s.missingSources
          .map((m) => SOURCE_FIELD_LABEL[m] ?? m)
          .join(", ")}]`
      );
    }
    if (s.visualDirection) lines.push(`    visual: ${s.visualDirection}`);
    if (s.imagePrompt) lines.push(`    image: ${s.imagePrompt}`);
    if (s.speakerNotes) lines.push(`    notes: ${s.speakerNotes}`);
    lines.push("");
    i++;
  }
  return lines.join("\n");
}

// --- HTML --------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function exportHtml(deck: PitchDeck): string {
  const slides = deck.slides
    .map((s, i) => {
      const missing = s.missingSources.length
        ? `<div class="warn">Missing: ${s.missingSources
            .map((m) => escapeHtml(SOURCE_FIELD_LABEL[m] ?? m))
            .join(", ")}</div>`
        : "";
      const visual = s.visualDirection
        ? `<div class="meta"><em>Visual direction:</em> ${escapeHtml(s.visualDirection)}</div>`
        : "";
      const image = s.imagePrompt
        ? `<div class="meta"><em>Image prompt:</em> <code>${escapeHtml(s.imagePrompt)}</code></div>`
        : "";
      const notes = s.speakerNotes
        ? `<div class="meta"><em>Speaker notes:</em> ${escapeHtml(s.speakerNotes)}</div>`
        : "";
      const copy = (s.copy || "").split(/\n\n+/).map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
      return `<section class="slide">
  <header><span class="num">${String(i + 1).padStart(2, "0")}</span><h2>${escapeHtml(s.title)}</h2></header>
  ${copy}
  ${missing}
  ${visual}
  ${image}
  ${notes}
</section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(deck.title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { --bone:#e9e6dc; --ink:#1a1a1a; --line:rgba(0,0,0,.08); --amber:#a86b00; }
    html,body { margin:0; padding:0; background:#faf8f3; color:var(--ink); font-family: "Inter", system-ui, sans-serif; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 64px 32px; }
    .deck-title { font-family: "Lora", Georgia, serif; font-size: 36px; margin: 0 0 4px; letter-spacing:-0.01em; }
    .deck-sub { color:#666; font-size: 13px; margin-bottom: 48px; letter-spacing:0.05em; text-transform:uppercase;}
    .slide { padding: 36px 0; border-top: 1px solid var(--line); }
    .slide header { display:flex; align-items:baseline; gap:14px; margin-bottom:12px; }
    .num { font-family: "JetBrains Mono", monospace; font-size: 12px; color:#999; }
    h2 { font-family: "Lora", Georgia, serif; font-size: 22px; margin:0; letter-spacing:-0.01em; }
    p { line-height:1.65; font-size:15px; margin: 0 0 12px; }
    .meta { font-size: 12px; color:#555; margin-top:8px; }
    code { background: rgba(0,0,0,.06); padding: 1px 6px; border-radius: 3px; }
    .warn { margin-top:8px; padding:6px 10px; border-left:3px solid var(--amber); background: rgba(168,107,0,.08); font-size: 12px; color: var(--amber); }
    footer { margin-top: 64px; padding-top: 20px; border-top:1px solid var(--line); font-size:11px; color:#888; }
  </style>
</head>
<body><div class="wrap">
  <h1 class="deck-title">${escapeHtml(deck.title)}</h1>
  <div class="deck-sub">${escapeHtml(DECK_KIND_LABEL[deck.kind])} · ${escapeHtml(deck.currentVersionLabel)}</div>
  ${slides}
  <footer>${escapeHtml(KIND_FOOTER)}</footer>
</div></body></html>`;
}

// --- PDF (slide-per-page, hand-rolled — same approach as screenplay PDF) ----

const PAGE_W = 612;
const PAGE_H = 792;
const LEFT = 72;
const TOP = 720;
const LINE_H = 16;
const COURIER = "F1";

function escapePdf(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(text: string, width = 70): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of raw.split(/\s+/)) {
      const tentative = line ? `${line} ${word}` : word;
      if (tentative.length > width) {
        out.push(line);
        line = word;
      } else {
        line = tentative;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function assemblePdf(pages: string[]): Uint8Array {
  const xref: number[] = [];
  let out = "%PDF-1.4\n%\xff\xff\xff\xff\n";
  const objects: string[] = [];

  const addObj = (contents: string): number => {
    const id = objects.length + 1;
    objects.push(contents);
    return id;
  };

  const fontId = addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>`);
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  for (const body of pages) {
    const stream = `BT /${COURIER} 12 Tf 14 TL\n${body}\nET`;
    const cid = addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    contentIds.push(cid);
  }
  const pagesId = objects.length + pages.length + 2; // placeholder
  for (let i = 0; i < pages.length; i++) {
    const pid = addObj(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentIds[i]} 0 R /Resources << /Font << /${COURIER} ${fontId} 0 R >> >> >>`
    );
    pageIds.push(pid);
  }
  const pagesObjId = addObj(
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((p) => `${p} 0 R`).join(" ")}] >>`
  );
  const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesObjId} 0 R >>`);

  for (let i = 0; i < objects.length; i++) {
    xref.push(out.length);
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const x of xref) out += `${x.toString().padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(out);
}

export function exportPdf(deck: PitchDeck): Uint8Array {
  const pages: string[] = [];
  // Cover page.
  {
    const lines: { text: string; size: number }[] = [
      { text: "", size: 200 },
      { text: deck.title, size: 24 },
      { text: DECK_KIND_LABEL[deck.kind], size: 12 },
      { text: deck.currentVersionLabel, size: 11 },
    ];
    let body = "";
    let y = TOP - 200;
    for (const ln of lines) {
      if (!ln.text) {
        y -= LINE_H;
        continue;
      }
      const w = ln.text.length * (ln.size * 0.6);
      const x = Math.max(LEFT, (PAGE_W - w) / 2);
      body += `BT /${COURIER} ${ln.size} Tf ${x.toFixed(0)} ${y} Td (${escapePdf(ln.text)}) Tj ET\n`;
      y -= ln.size + 6;
    }
    pages.push(body);
  }

  for (const s of deck.slides) {
    const body: string[] = [];
    let y = TOP;
    // Title.
    body.push(`BT /${COURIER} 18 Tf ${LEFT} ${y} Td (${escapePdf(s.title)}) Tj ET`);
    y -= 24;
    // Copy (wrap at ~70 cols).
    for (const ln of wrap(s.copy || "(missing copy)", 64)) {
      if (y < 80) break;
      body.push(`BT /${COURIER} 12 Tf ${LEFT} ${y} Td (${escapePdf(ln)}) Tj ET`);
      y -= LINE_H;
    }
    if (s.missingSources.length) {
      y -= 8;
      body.push(
        `BT /${COURIER} 10 Tf ${LEFT} ${y} Td (${escapePdf(
          "[Missing: " +
            s.missingSources.map((m) => SOURCE_FIELD_LABEL[m] ?? m).join(", ") +
            "]"
        )}) Tj ET`
      );
      y -= LINE_H;
    }
    if (s.visualDirection) {
      y -= 6;
      for (const ln of wrap("Visual direction: " + s.visualDirection, 70)) {
        if (y < 80) break;
        body.push(`BT /${COURIER} 10 Tf ${LEFT} ${y} Td (${escapePdf(ln)}) Tj ET`);
        y -= LINE_H;
      }
    }
    if (s.imagePrompt) {
      y -= 6;
      for (const ln of wrap("Image prompt: " + s.imagePrompt, 70)) {
        if (y < 80) break;
        body.push(`BT /${COURIER} 10 Tf ${LEFT} ${y} Td (${escapePdf(ln)}) Tj ET`);
        y -= LINE_H;
      }
    }
    if (s.speakerNotes) {
      y -= 6;
      for (const ln of wrap("Speaker notes: " + s.speakerNotes, 70)) {
        if (y < 80) break;
        body.push(`BT /${COURIER} 10 Tf ${LEFT} ${y} Td (${escapePdf(ln)}) Tj ET`);
        y -= LINE_H;
      }
    }
    pages.push(body.join("\n"));
  }

  return assemblePdf(pages);
}

export function exportDeck(deck: PitchDeck, format: PitchFormat): { data: string | Uint8Array; mime: string; ext: string } {
  switch (format) {
    case "markdown":
      return { data: exportMarkdown(deck), mime: "text/markdown", ext: "md" };
    case "html":
      return { data: exportHtml(deck), mime: "text/html", ext: "html" };
    case "text":
      return { data: exportText(deck), mime: "text/plain", ext: "txt" };
    case "pdf":
      return { data: exportPdf(deck), mime: "application/pdf", ext: "pdf" };
  }
}
