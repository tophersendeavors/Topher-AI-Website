import type { ParsedScreenplay } from "@toburt/shared";

export function exportMarkdown(parsed: ParsedScreenplay): string {
  const lines: string[] = [];
  if (parsed.title) lines.push(`# ${parsed.title}`);
  if (parsed.authors?.length) lines.push(`_by ${parsed.authors.join(", ")}_`);
  lines.push("");

  for (const el of parsed.elements) {
    switch (el.kind) {
      case "scene_heading":
        lines.push(`## ${el.text}`);
        break;
      case "character":
        lines.push(`**${el.text}**`);
        break;
      case "parenthetical":
        lines.push(`> _${el.text.replace(/^\(|\)$/g, "")}_`);
        break;
      case "dialogue":
        lines.push(`> ${el.text}`);
        break;
      case "transition":
        lines.push(`---  _${el.text}_  ---`);
        break;
      case "section":
        lines.push(`### ${el.text.replace(/^#+\s*/, "")}`);
        break;
      case "action":
      default:
        lines.push(el.text);
    }
    lines.push("");
  }
  return lines.join("\n");
}
