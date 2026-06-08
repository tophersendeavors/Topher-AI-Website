import type { ParsedScreenplay, ScreenplayElement } from "@toburt/shared";

/**
 * Minimal PDF screenplay exporter. Emits a single-document PDF with the
 * screenplay laid out using industry margins (1.5" left, 1.0" right/top/bot,
 * Courier 12pt). This is a hand-rolled writer so we don't pull in a heavy
 * dependency — it covers the elements our editor produces.
 *
 * Unicode/encoding: the font dictionary declares
 *   /Encoding /WinAnsiEncoding
 * which lets us address the WinAnsi (≈ CP1252) glyph set. That covers the
 * characters writers actually need in screenplays:
 *   • em dash —  → byte 0x97
 *   • en dash –  → byte 0x96
 *   • curly quotes ‘ ’ “ ”  → bytes 0x91..0x94
 *   • ellipsis …  → byte 0x85
 *   • bullet •  → byte 0x95
 *   • Latin-1 accented letters (é, ó, á, í, ñ, …)  → bytes 0xA0..0xFF
 * Anything outside WinAnsi is run through NFKD decomposition (José → Jose,
 * but only as a LAST resort if the precomposed form isn't in the map).
 * Anything still non-ASCII after that becomes `?` and is reported in
 * `auditPdfText`. The previous implementation was destroying em dashes,
 * curly quotes, and all accented characters because of a typo in a regex
 * range (`[-￿]` matched everything from `-` to U+FFFF and replaced with
 * `?`); that's now gone.
 *
 * Returns a Buffer (Uint8Array) ready to send as `application/pdf`.
 */
export function exportPDF(parsed: ParsedScreenplay): Uint8Array {
  const lines: { text: string; indent: number; bold?: boolean; centered?: boolean; pageBreak?: boolean }[] = [];

  // -------- TITLE PAGE --------
  // When the full TitlePageMeta is present, lay it out as a proper title
  // page (centered series title, episode credit, written/created credits,
  // draft + date, contact / studio / copyright at the bottom) followed by
  // a page break so the script body starts on its own page.
  const tp = parsed.titlePage;
  if (tp) {
    // Vertical air at top of title page
    for (let i = 0; i < 14; i++) lines.push({ text: "", indent: 0 });
    lines.push({ text: tp.seriesTitle.toUpperCase(), indent: 0, bold: true, centered: true });
    if (tp.episodeCredit) {
      lines.push({ text: "", indent: 0 });
      lines.push({ text: tp.episodeCredit, indent: 0, centered: true });
    }
    // Air, then "Written by"
    for (let i = 0; i < 6; i++) lines.push({ text: "", indent: 0 });
    if (tp.writers?.length) {
      lines.push({ text: "Written by", indent: 0, centered: true });
      lines.push({ text: "", indent: 0 });
      lines.push({ text: tp.writers.join(", "), indent: 0, centered: true });
    }
    if (tp.creators?.length) {
      lines.push({ text: "", indent: 0 });
      lines.push({ text: "", indent: 0 });
      lines.push({ text: `Created by ${tp.creators.join(", ")}`, indent: 0, centered: true });
    }
    if (tp.basedOn) {
      lines.push({ text: "", indent: 0 });
      lines.push({ text: `Based on ${tp.basedOn}`, indent: 0, centered: true });
    }
    // Bottom of page block
    for (let i = 0; i < 10; i++) lines.push({ text: "", indent: 0 });
    if (tp.draftLabel) lines.push({ text: tp.draftLabel, indent: 0, centered: true });
    if (tp.draftDate) lines.push({ text: tp.draftDate, indent: 0, centered: true });
    if (tp.includeContact !== false) {
      if (tp.studio) {
        lines.push({ text: "", indent: 0 });
        lines.push({ text: tp.studio, indent: 0, centered: true });
      }
      if (tp.contact) lines.push({ text: tp.contact, indent: 0, centered: true });
    }
    if (tp.copyright) {
      lines.push({ text: "", indent: 0 });
      lines.push({ text: tp.copyright, indent: 0, centered: true });
    }
    // Force page break — body starts fresh.
    lines.push({ text: "", indent: 0, pageBreak: true });
  } else if (parsed.title) {
    // Backwards-compat fallback (older callers that don't pass titlePage).
    lines.push({ text: "", indent: 0 });
    lines.push({ text: parsed.title.toUpperCase(), indent: 0, bold: true, centered: true });
    if (parsed.authors?.length) {
      lines.push({ text: "", indent: 0 });
      lines.push({ text: `by ${parsed.authors.join(", ")}`, indent: 0, centered: true });
    }
    lines.push({ text: "", indent: 0 });
  }

  for (const el of parsed.elements) {
    lines.push(...renderElement(el));
    lines.push({ text: "", indent: 0 });
  }

  // Layout
  const PAGE_W = 612; // 8.5"
  const PAGE_H = 792; // 11"
  const LEFT = 108; // 1.5"
  const TOP = 720; // 1" from top → y = 720 (PDF origin is bottom-left)
  const LINE_H = 14;
  const COURIER = "F1";

  const pages: string[] = [];
  let y = TOP;
  let body = "";

  function newPage() {
    pages.push(body);
    body = "";
    y = TOP;
  }

  for (const ln of lines) {
    if (ln.pageBreak) {
      newPage();
      continue;
    }
    if (y < 72) newPage();
    // The text we lay out is already WinAnsi-normalized — 1 JS char per
    // displayed glyph slot — so `.length` is the correct column count
    // for Courier (monospace) centering math.
    const normalized = normalizeForWinAnsi(ln.text);
    let x = LEFT + ln.indent;
    if (ln.centered) {
      // Centered lines: each Courier 12pt char is ≈ 7.2pt wide.
      const w = normalized.length * 7.2;
      x = Math.max(LEFT, Math.floor((PAGE_W - w) / 2));
    }
    const escaped = encodePdfLiteral(normalized);
    body += `BT /${COURIER} 12 Tf ${x} ${y} Td (${escaped}) Tj ET\n`;
    y -= LINE_H;
  }
  pages.push(body);

  return assemblePdf(pages, PAGE_W, PAGE_H);
}

function renderElement(el: ScreenplayElement): Array<{ text: string; indent: number }> {
  // Industry-standard horizontal positioning (offsets from the LEFT margin):
  //   action / scene heading: 0
  //   character:              222
  //   parenthetical:          168
  //   dialogue:               108
  //   transition:             427 (right-aligned)
  switch (el.kind) {
    case "scene_heading":
      return wrap(el.text.toUpperCase(), 0, 60);
    case "action":
      return wrap(el.text, 0, 60);
    case "character":
      return wrap(el.text.toUpperCase(), 222, 38);
    case "parenthetical":
      return wrap(el.text, 168, 34);
    case "dialogue":
      return wrap(el.text, 108, 38);
    case "transition":
      return wrap(el.text.toUpperCase(), 427, 14);
    case "shot":
      return wrap(el.text.toUpperCase(), 0, 60);
    default:
      return wrap(el.text, 0, 60);
  }
}

function wrap(text: string, indent: number, cols: number): Array<{ text: string; indent: number }> {
  // Wrap on a WinAnsi-normalized copy so column math counts visible glyphs,
  // not the upstream JS code units. The actual line texts we return are
  // chunks of THIS normalized string; the PDF emitter will normalize again
  // (idempotent) and emit octal escapes for the high bytes.
  const normalized = normalizeForWinAnsi(text);
  const words = normalized.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + (line ? " " : "") + w).length > cols) {
      if (line) out.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) out.push(line);
  return out.map((s) => ({ text: s, indent }));
}

// ---------------------------------------------------------------------------
// Unicode → WinAnsi normalization
// ---------------------------------------------------------------------------
//
// Two-step pipeline:
//
//   1. `normalizeForWinAnsi(s)` → returns a JS string where every char is
//      either:
//        • printable ASCII 0x20..0x7E, OR
//        • a single JS char whose codepoint == its WinAnsi byte value
//          (e.g. em dash collapses to "", é to "é").
//      So `out.length` equals the displayed glyph count.
//
//   2. `encodePdfLiteral(s)` → escapes parens/backslashes and turns any
//      char above 0x7E into a `\NNN` octal escape so the resulting PDF
//      content stream is pure ASCII bytes. WinAnsiEncoding on the font
//      then maps those bytes back to the right glyphs at render time.
//
// Chars that don't fit into WinAnsi (rare Unicode, emoji, CJK) get
// decomposed via NFKD and stripped of combining marks — so "São Paulo"
// stays "São Paulo" (ã is in WinAnsi), but exotic punctuation that
// doesn't decompose to printable ASCII ends up as `?` and is reported
// by `auditPdfText`.

const SMART_PUNCT_TO_WINANSI_BYTE: Record<string, number> = {
  "–": 0x96, // – en dash
  "—": 0x97, // — em dash
  "―": 0x97, // ― horizontal bar → em dash
  "‘": 0x91, // ‘ left single quote
  "’": 0x92, // ’ right single quote / apostrophe
  "‚": 0x82, // ‚ single low-9 quote
  "‛": 0x91, // ‛ reversed single quote → left single
  "“": 0x93, // “ left double quote
  "”": 0x94, // ” right double quote
  "„": 0x84, // „ double low-9 quote
  "‟": 0x93, // ‟ reversed double quote → left double
  "•": 0x95, // • bullet
  "…": 0x85, // … ellipsis
  "‹": 0x8B, // ‹ single left guillemet
  "›": 0x9B, // › single right guillemet
  "€": 0x80, // € euro
  "™": 0x99, // ™ trademark
  "ˆ": 0x88, // ˆ modifier circumflex
  "˜": 0x98, // ˜ small tilde
  "Œ": 0x8C, // Œ
  "œ": 0x9C, // œ
  "Š": 0x8A, // Š
  "š": 0x9A, // š
  "Ÿ": 0x9F, // Ÿ
  "Ž": 0x8E, // Ž
  "ž": 0x9E, // ž
  "ƒ": 0x83, // ƒ
  " ": 0x20, // NBSP → regular space (safer for monospace layout)
};

/**
 * Convert each codepoint in `input` to one JS char whose value matches its
 * WinAnsi byte. Anything that can't be mapped is decomposed via NFKD and
 * combining marks stripped; remaining non-ASCII is replaced with `?`.
 *
 * The result is intentionally a JS string (not bytes) so the rest of the
 * layout pipeline can keep using `.length` for monospace column math.
 */
export function normalizeForWinAnsi(input: string): string {
  // Normalize line endings first so wrapping/centering see consistent input.
  const s = input.replace(/\r\n?/g, "\n");
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    // Pass through any byte that already maps to a WinAnsi glyph:
    //   • 0x20..0x7E — printable ASCII
    //   • 0x80..0x9F — typographic punctuation (em dash, curly quotes,
    //     ellipsis, …) once we've already mapped them
    //   • 0xA0..0xFF — Latin-1 supplement (accented Latin letters)
    // The 0x80..0x9F range is necessary to make normalization IDEMPOTENT
    // — wrap() normalizes for column math, then exportPDF normalizes
    // again for centering. Without 0x80..0x9F in the passthrough set,
    // the second pass would `?`-replace every smart-punct byte the
    // first pass just produced.
    if (
      (code >= 0x20 && code <= 0x7E) ||
      (code >= 0x80 && code <= 0xFF)
    ) {
      out += ch;
      continue;
    }
    // Newlines and tabs survive intact for downstream wrapping.
    if (code === 0x0A || code === 0x09) {
      out += ch;
      continue;
    }
    // Smart punctuation / typographic symbols in WinAnsi 0x80..0x9F —
    // their original Unicode codepoints (em dash U+2014, etc.) map
    // into WinAnsi via this table.
    const mapped = SMART_PUNCT_TO_WINANSI_BYTE[ch];
    if (mapped !== undefined) {
      out += String.fromCharCode(mapped);
      continue;
    }
    // Fallback: NFKD decompose, strip combining marks, re-test.
    const decomp = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    if (decomp !== ch && decomp.length > 0) {
      // Recurse once on the decomposition — it may now be plain ASCII or
      // a precomposed form we DO recognize.
      out += normalizeForWinAnsi(decomp);
      continue;
    }
    // Last resort.
    out += "?";
  }
  return out;
}

function encodePdfLiteral(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x28) {
      // (
      out += "\\(";
    } else if (code === 0x29) {
      // )
      out += "\\)";
    } else if (code === 0x5C) {
      // \
      out += "\\\\";
    } else if (code >= 0x20 && code <= 0x7E) {
      out += s[i];
    } else if (code >= 0x80 && code <= 0xFF) {
      // Octal escape — three digits, padded.
      out += "\\" + code.toString(8).padStart(3, "0");
    } else {
      // Shouldn't happen after normalizeForWinAnsi, but be safe.
      out += "?";
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Export audit
// ---------------------------------------------------------------------------

export interface PdfExportAudit {
  ok: boolean;
  /** Bytes that the raw input already had replacement characters (U+FFFD)
   *  — these indicate UTF-8 decode failures earlier in the pipeline. */
  replacementCharsInInput: number;
  /** Total characters in the input that would be substituted with `?`
   *  because they can't be represented in WinAnsi + NFKD-stripped ASCII. */
  unsupportedCharCount: number;
  /** Up to 10 example unsupported codepoints (de-duplicated, hex). */
  unsupportedSamples: string[];
  /** Spot checks on key strings — true means the round-trip preserves them. */
  roundTripChecks: Array<{ input: string; preserved: boolean; rendered: string }>;
}

/**
 * Audit a parsed screenplay for PDF export safety. Surfaces:
 *   • upstream UTF-8 decode failures (U+FFFD replacement chars)
 *   • codepoints that would be substituted with `?`
 *   • round-trip preservation of known-good fixtures (San José, Tilarán,
 *     "she pauses — quietly", curly-quoted dialogue)
 *
 * Callers (e.g. `routes/exports.ts`) can surface these via response
 * headers so the UI can warn the showrunner if anything was dropped.
 */
export function auditPdfText(parsed: ParsedScreenplay): PdfExportAudit {
  // Gather every text fragment the PDF will emit (title-page + elements).
  const fragments: string[] = [];
  const tp = parsed.titlePage;
  if (tp) {
    fragments.push(
      tp.seriesTitle ?? "",
      tp.episodeCredit ?? "",
      ...(tp.writers ?? []),
      ...(tp.creators ?? []),
      tp.basedOn ?? "",
      tp.draftLabel ?? "",
      tp.draftDate ?? "",
      tp.studio ?? "",
      tp.contact ?? "",
      tp.copyright ?? ""
    );
  } else if (parsed.title) {
    fragments.push(parsed.title, ...(parsed.authors ?? []));
  }
  for (const el of parsed.elements) fragments.push(el.text);
  const all = fragments.join("\n");

  const replacementCharsInInput = (all.match(/�/g) ?? []).length;

  // Count chars normalizeForWinAnsi would turn into `?` (because the
  // original codepoint isn't representable). We re-run normalization
  // here and look for `?` codepoints that AREN'T in the original input.
  const originalQuestionMarks = (all.match(/\?/g) ?? []).length;
  const normalized = normalizeForWinAnsi(all);
  const normalizedQuestionMarks = (normalized.match(/\?/g) ?? []).length;
  const unsupportedCharCount = Math.max(
    0,
    normalizedQuestionMarks - originalQuestionMarks
  );

  // Pull a few example codepoints that would be dropped.
  const seen = new Set<string>();
  const samples: string[] = [];
  for (const ch of all) {
    if (samples.length >= 10) break;
    const code = ch.codePointAt(0)!;
    if (
      (code >= 0x20 && code <= 0x7E) ||
      (code >= 0xA0 && code <= 0xFF) ||
      code === 0x0A ||
      code === 0x09 ||
      SMART_PUNCT_TO_WINANSI_BYTE[ch] !== undefined
    ) {
      continue;
    }
    const decomp = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    if (decomp && /^[\x20-\x7E]+$/.test(decomp)) continue;
    if (decomp && decomp !== ch) continue; // recursable
    const hex = "U+" + code.toString(16).toUpperCase().padStart(4, "0");
    if (!seen.has(hex)) {
      seen.add(hex);
      samples.push(`${hex} (${ch})`);
    }
  }

  // Round-trip spot checks. We verify these famously-tricky strings get
  // through the encoder unchanged at the rendered-byte level. The "rendered"
  // value is what the PDF reader will end up displaying (decoded back via
  // WinAnsi for the assertion).
  const checks = [
    "San José",
    "Tilarán",
    "Her hand goes to her recorder — touches it.",
    "She said “yes” and then ‘no.’",
    "Three things: 1, 2, 3…",
  ];
  const roundTripChecks = checks.map((input) => {
    const normalizedInput = normalizeForWinAnsi(input);
    const literal = encodePdfLiteral(normalizedInput);
    const renderedBytes = decodeOctalToBytes(literal);
    const rendered = bytesToWinAnsi(renderedBytes);
    // The rendered form preserves the input if smart punctuation maps
    // cleanly back to the original (which it does — WinAnsi covers all
    // these glyphs). Accented Latin-1 chars are byte-identical to their
    // Unicode codepoints, so equality holds.
    return { input, preserved: rendered === input, rendered };
  });

  const ok =
    replacementCharsInInput === 0 &&
    unsupportedCharCount === 0 &&
    roundTripChecks.every((c) => c.preserved);

  return {
    ok,
    replacementCharsInInput,
    unsupportedCharCount,
    unsupportedSamples: samples,
    roundTripChecks,
  };
}

/** Decode the PDF-literal-escape string back to its byte sequence — used
 *  only inside the audit so we can re-construct what a viewer will see. */
function decodeOctalToBytes(literal: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < literal.length; i++) {
    const ch = literal[i];
    if (ch === "\\") {
      const next = literal[i + 1];
      if (next === "(" || next === ")" || next === "\\") {
        out.push(next.charCodeAt(0));
        i += 1;
        continue;
      }
      // Octal — up to 3 digits.
      let oct = "";
      while (oct.length < 3 && /[0-7]/.test(literal[i + 1 + oct.length] ?? "")) {
        oct += literal[i + 1 + oct.length];
      }
      if (oct) {
        out.push(parseInt(oct, 8));
        i += oct.length;
        continue;
      }
    }
    out.push(literal.charCodeAt(i));
  }
  return new Uint8Array(out);
}

/** WinAnsi 0x80..0x9F → Unicode codepoint lookup. The rest of 0x00..0xFF
 *  is identical to Unicode (0x20..0x7E is ASCII, 0xA0..0xFF is Latin-1). */
const WINANSI_HIGH_TO_UNICODE: Record<number, string> = {
  0x80: "€",
  0x82: "‚",
  0x83: "ƒ",
  0x84: "„",
  0x85: "…",
  0x86: "†",
  0x87: "‡",
  0x88: "ˆ",
  0x89: "‰",
  0x8A: "Š",
  0x8B: "‹",
  0x8C: "Œ",
  0x8E: "Ž",
  0x91: "‘",
  0x92: "’",
  0x93: "“",
  0x94: "”",
  0x95: "•",
  0x96: "–",
  0x97: "—",
  0x98: "˜",
  0x99: "™",
  0x9A: "š",
  0x9B: "›",
  0x9C: "œ",
  0x9E: "ž",
  0x9F: "Ÿ",
};

function bytesToWinAnsi(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    if (b >= 0x20 && b <= 0x7E) {
      out += String.fromCharCode(b);
    } else if (b >= 0xA0 && b <= 0xFF) {
      // Latin-1 supplement
      out += String.fromCharCode(b);
    } else if (WINANSI_HIGH_TO_UNICODE[b]) {
      out += WINANSI_HIGH_TO_UNICODE[b];
    } else if (b === 0x0A || b === 0x09) {
      out += String.fromCharCode(b);
    } else {
      out += "?";
    }
  }
  return out;
}

function assemblePdf(pages: string[], w: number, h: number): Uint8Array {
  // Build a minimal PDF 1.4 document with N page objects + 1 shared font.
  // The font declares /Encoding /WinAnsiEncoding so the octal byte escapes
  // we emit in content streams (0x80..0xFF) render as the right glyphs.
  const objects: string[] = [];
  const offsets: number[] = [];
  let body = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";

  function addObject(content: string) {
    const id = objects.length + 1;
    offsets[id] = body.length;
    const obj = `${id} 0 obj\n${content}\nendobj\n`;
    objects.push(obj);
    body += obj;
    return id;
  }

  const fontId = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"
  );
  const pageIds: number[] = [];
  const pagesIdPlaceholder = objects.length + pages.length * 2 + 1; // pages root id

  // Page content streams + page objects.
  for (const stream of pages) {
    const contentId = addObject(
      `<< /Length ${stream.length} >>\nstream\n${stream}endstream`
    );
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesIdPlaceholder} 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  }

  // Pages root.
  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
  const pagesId = addObject(
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${kids}] >>`
  );
  if (pagesId !== pagesIdPlaceholder) {
    // The placeholder must match. If not, rewrite pages-root references.
    for (let i = 0; i < pages.length; i++) {
      body = body.replace(
        new RegExp(`/Parent ${pagesIdPlaceholder} 0 R`),
        `/Parent ${pagesId} 0 R`
      );
    }
  }

  // Catalog.
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  // xref
  const xrefStart = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${offsets[i].toString().padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer << /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  // The body is pure ASCII (we use `\xE2\xE3\xCF\xD3` JS escape for the
  // %PDF binary marker so it lands as 4 bytes 0xE2..0xD3 — not the UTF-8
  // encoding of those Unicode codepoints — and all content streams emit
  // octal escapes for non-ASCII bytes). So /Length values, which we
  // computed against the JS `.length`, exactly equal the byte count.
  const bytes = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i) & 0xFF;
  return bytes;
}
