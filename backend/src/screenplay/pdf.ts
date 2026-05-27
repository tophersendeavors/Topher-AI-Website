import type { ParsedScreenplay, ScreenplayElement } from "@toburt/shared";

/**
 * Minimal PDF screenplay exporter. Emits a single-document PDF with the
 * screenplay laid out using industry margins (1.5" left, 1.0" right/top/bot,
 * Courier 12pt). This is a hand-rolled writer so we don't pull in a heavy
 * dependency — it covers the elements our editor produces.
 *
 * Returns a Buffer (Uint8Array) ready to send as `application/pdf`.
 */
export function exportPDF(parsed: ParsedScreenplay): Uint8Array {
  const lines: { text: string; indent: number; bold?: boolean; centered?: boolean }[] = [];

  if (parsed.title) {
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
    if (y < 72) newPage();
    const x = LEFT + ln.indent;
    const text = escapePdf(ln.text);
    body += `BT /${COURIER} 12 Tf ${x} ${y} Td (${text}) Tj ET\n`;
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
  const words = text.split(/\s+/);
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

function escapePdf(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[-￿]/g, "?");
}

function assemblePdf(pages: string[], w: number, h: number): Uint8Array {
  // Build a minimal PDF 1.4 document with N page objects + 1 shared font.
  const objects: string[] = [];
  const offsets: number[] = [];
  let body = "%PDF-1.4\n%âãÏÓ\n";

  function addObject(content: string) {
    const id = objects.length + 1;
    offsets[id] = body.length;
    const obj = `${id} 0 obj\n${content}\nendobj\n`;
    objects.push(obj);
    body += obj;
    return id;
  }

  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
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

  return new TextEncoder().encode(body);
}
