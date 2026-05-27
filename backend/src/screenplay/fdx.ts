import type { ParsedScreenplay, ScreenplayElement } from "@toburt/shared";

/**
 * Minimal Final Draft (.fdx) exporter. FDX is an XML schema; we emit the
 * minimum subset Final Draft accepts (TitlePage + body Paragraphs).
 */
export function exportFDX(parsed: ParsedScreenplay): string {
  const body = parsed.elements.map(toParagraph).join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<FinalDraft DocumentType="Script" Template="No" Version="5">',
    "  <Content>",
    body,
    "  </Content>",
    parsed.title ? titlePage(parsed) : "",
    "</FinalDraft>",
  ]
    .filter(Boolean)
    .join("\n");
}

function toParagraph(el: ScreenplayElement): string {
  const type = mapType(el.kind);
  return `    <Paragraph Type="${type}"><Text>${escapeXml(el.text)}</Text></Paragraph>`;
}

function mapType(kind: ScreenplayElement["kind"]): string {
  switch (kind) {
    case "scene_heading":
      return "Scene Heading";
    case "action":
      return "Action";
    case "character":
      return "Character";
    case "parenthetical":
      return "Parenthetical";
    case "dialogue":
      return "Dialogue";
    case "transition":
      return "Transition";
    case "shot":
      return "Shot";
    case "centered":
      return "General";
    default:
      return "General";
  }
}

function titlePage(p: ParsedScreenplay): string {
  return [
    "  <TitlePage>",
    "    <Content>",
    `      <Paragraph Alignment="Center"><Text>${escapeXml(p.title ?? "")}</Text></Paragraph>`,
    p.authors?.length
      ? `      <Paragraph Alignment="Center"><Text>by ${escapeXml(p.authors.join(", "))}</Text></Paragraph>`
      : "",
    "    </Content>",
    "  </TitlePage>",
  ]
    .filter(Boolean)
    .join("\n");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
