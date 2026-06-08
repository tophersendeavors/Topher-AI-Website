import type { ParsedScene, ParsedScreenplay, ScreenplayElement } from "@toburt/shared";

/**
 * A pragmatic, deliberately small Fountain parser. Covers the constructs the
 * agents and editor actually emit: scene headings, action, character,
 * parenthetical, dialogue, transitions, title pages, sections, boneyard
 * blocks. Not a spec-complete implementation — that lives behind the
 * /screenplay/parse?strict=true flag (future work).
 */
const SCENE_HEADING_RE = /^(?:\.|INT\.?|EXT\.?|EST\.?|INT\.?\/EXT\.?|I\/E\.?)\b.*$/i;
const TRANSITION_RE = /^(?:[A-Z' ]+ TO:|FADE OUT\.?|CUT TO BLACK\.?)$/;
const CHARACTER_RE = /^[A-Z][A-Z0-9 .'_-]+(\s*\(.+\))?$/;

/**
 * The first scene heading (slugline) in a chunk of Fountain — used to keep a
 * scene's stored slugline metadata in sync with the heading actually written
 * in its body. Returns null if no heading is present.
 */
export function firstSlugline(text: string): string | null {
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line && SCENE_HEADING_RE.test(line)) return line.replace(/^\./, "").trim();
  }
  return null;
}

export function parseFountain(text: string): ParsedScreenplay {
  const lines = text.split(/\r?\n/);
  const elements: ScreenplayElement[] = [];
  const scenes: ParsedScene[] = [];

  let titleBlock: Record<string, string> = {};
  let inTitlePage = true;
  let inBoneyard = false;
  let sceneAccum: ParsedScene | null = null;
  let order = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // boneyard
    if (line.startsWith("/*")) {
      inBoneyard = true;
      continue;
    }
    if (inBoneyard) {
      if (line.endsWith("*/")) inBoneyard = false;
      continue;
    }

    // title page: key: value pairs until first blank line
    if (inTitlePage) {
      if (line.trim() === "" && Object.keys(titleBlock).length) {
        inTitlePage = false;
        continue;
      }
      const m = line.match(/^([A-Za-z][A-Za-z _]*):\s*(.*)$/);
      if (m) {
        titleBlock[m[1].toLowerCase()] = m[2];
        continue;
      } else if (Object.keys(titleBlock).length === 0) {
        // No title page — bail out
        inTitlePage = false;
      } else {
        continue;
      }
    }

    // Scene heading
    if (SCENE_HEADING_RE.test(line.trim())) {
      closeScene();
      const heading = line.trim().replace(/^\./, "");
      const intExt = parseIntExt(heading);
      const { location, timeOfDay } = parseSlugline(heading);
      sceneAccum = {
        order: ++order,
        slugline: heading,
        intExt,
        location,
        timeOfDay,
        characters: [],
        startLine: i,
        endLine: i,
        fountain: "",
        elements: [],
      };
      const el: ScreenplayElement = { kind: "scene_heading", text: heading };
      elements.push(el);
      sceneAccum.elements.push(el);
      continue;
    }

    // Transition
    if (TRANSITION_RE.test(line.trim())) {
      const el: ScreenplayElement = { kind: "transition", text: line.trim() };
      pushTo(elements, sceneAccum, el);
      continue;
    }

    // Section / synopsis
    if (line.startsWith("#")) {
      const el: ScreenplayElement = { kind: "section", text: line };
      pushTo(elements, sceneAccum, el);
      continue;
    }
    if (line.startsWith("=")) {
      const el: ScreenplayElement = { kind: "synopsis", text: line.replace(/^=+/, "").trim() };
      pushTo(elements, sceneAccum, el);
      continue;
    }

    // Character + dialogue
    if (
      line.trim() !== "" &&
      CHARACTER_RE.test(line.trim()) &&
      (lines[i + 1] ?? "").trim() !== "" &&
      // next non-empty line must be either parenthetical or dialogue
      true
    ) {
      const charText = line.trim();
      const char: ScreenplayElement = { kind: "character", text: charText };
      pushTo(elements, sceneAccum, char);
      if (sceneAccum && !sceneAccum.characters.includes(stripExt(charText))) {
        sceneAccum.characters.push(stripExt(charText));
      }
      // consume parenthetical + dialogue lines
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "") {
        const sub = lines[j].trim();
        if (sub.startsWith("(") && sub.endsWith(")")) {
          pushTo(elements, sceneAccum, { kind: "parenthetical", text: sub });
        } else {
          pushTo(elements, sceneAccum, { kind: "dialogue", text: sub });
        }
        j++;
      }
      i = j;
      continue;
    }

    // Blank
    if (line.trim() === "") continue;

    // Default: action
    const el: ScreenplayElement = { kind: "action", text: line };
    pushTo(elements, sceneAccum, el);
  }

  closeScene();

  function closeScene() {
    if (!sceneAccum) return;
    sceneAccum.endLine = scenes.length ? scenes[scenes.length - 1].endLine + 1 : sceneAccum.endLine;
    sceneAccum.fountain = sceneAccum.elements
      .map((e) => elementToFountain(e))
      .join("\n\n");
    scenes.push(sceneAccum);
    sceneAccum = null;
  }

  return {
    title: titleBlock.title,
    authors: titleBlock.author ? [titleBlock.author] : undefined,
    scenes,
    elements,
  };
}

function pushTo(
  arr: ScreenplayElement[],
  scene: ParsedScene | null,
  el: ScreenplayElement
) {
  arr.push(el);
  if (scene) scene.elements.push(el);
}

function parseIntExt(heading: string): "INT" | "EXT" | "INT/EXT" | null {
  const upper = heading.toUpperCase();
  if (upper.startsWith("INT/EXT") || upper.startsWith("I/E")) return "INT/EXT";
  if (upper.startsWith("INT")) return "INT";
  if (upper.startsWith("EXT")) return "EXT";
  return null;
}

function parseSlugline(heading: string): { location: string; timeOfDay: string } {
  // "INT. LOCATION - TIME" → split on the last " - "
  const stripped = heading.replace(/^(INT\.?|EXT\.?|EST\.?|INT\.?\/EXT\.?|I\/E\.?)\s*/i, "");
  const idx = stripped.lastIndexOf(" - ");
  if (idx === -1) return { location: stripped.trim(), timeOfDay: "" };
  return {
    location: stripped.slice(0, idx).trim(),
    timeOfDay: stripped.slice(idx + 3).trim(),
  };
}

function stripExt(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export function elementToFountain(el: ScreenplayElement): string {
  switch (el.kind) {
    case "scene_heading":
      return el.text;
    case "transition":
      return el.text;
    case "character":
      return el.text;
    case "parenthetical":
      return el.text.startsWith("(") ? el.text : `(${el.text})`;
    case "dialogue":
      return el.text;
    case "section":
      return el.text;
    case "synopsis":
      return `= ${el.text}`;
    case "action":
    default:
      return el.text;
  }
}

export function formatFountain(parsed: ParsedScreenplay): string {
  const blocks: string[] = [];
  if (parsed.title) {
    const lines = [`Title: ${parsed.title}`];
    if (parsed.authors?.length) lines.push(`Author: ${parsed.authors.join(", ")}`);
    blocks.push(lines.join("\n"));
  }
  let prevKind: string | null = null;
  for (const el of parsed.elements) {
    const out = elementToFountain(el);
    // dialogue follows character/parenthetical without a blank line
    if (
      (el.kind === "dialogue" || el.kind === "parenthetical") &&
      (prevKind === "character" || prevKind === "parenthetical" || prevKind === "dialogue")
    ) {
      blocks[blocks.length - 1] += `\n${out}`;
    } else {
      blocks.push(out);
    }
    prevKind = el.kind;
  }
  return blocks.join("\n\n");
}
