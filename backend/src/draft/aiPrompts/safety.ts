// Safety / content routing. Scans the Master Shot Brief for content
// categories that public AI video platforms refuse, surfaces a structured
// warning, and proposes COMPLIANT cinematic alternatives. Manual override
// must still respect these warnings — the system never tries to bypass
// platform safety policy.

export type SafetyCategory =
  | "violence"
  | "weapons"
  | "sexual"
  | "nudity"
  | "minors"
  | "drugs"
  | "self_harm"
  | "trauma";

export const SAFETY_CATEGORY_LABEL: Record<SafetyCategory, string> = {
  violence: "Graphic violence",
  weapons: "Weapons / firearms",
  sexual: "Sexual content",
  nudity: "Nudity",
  minors: "Minors in sensitive context",
  drugs: "Drugs / substance use",
  self_harm: "Self-harm",
  trauma: "Trauma / abuse",
};

// Conservative keyword tells. Per-category. The router shows the flags to
// the writer; it does not silently rewrite.
const TELLS: Record<SafetyCategory, RegExp[]> = {
  violence: [
    /\b(murder|kills?|killing|stab|shoot(s|ing)?|beats? (her|him|them)|blood|wound|bruis|smash(es|ed)?|punch(es|ed)?|strangl)/i,
    /\bgraphic violence\b/i,
  ],
  weapons: [/\b(gun|pistol|rifle|knife|blade|machete|weapon|firearm|switchblade|katana)\b/i],
  sexual: [
    /\b(sex|sexual|making love|orgasm|masturbat|kissing intensely)\b/i,
    /\bnude scene\b/i,
  ],
  nudity: [/\b(nude|naked|topless|undress|stripped)\b/i],
  minors: [
    /\b(child|children|kid|teenager|teen|minor|11[- ]year[- ]old|12[- ]year[- ]old|13[- ]year[- ]old|14[- ]year[- ]old|15[- ]year[- ]old|16[- ]year[- ]old|17[- ]year[- ]old)\b/i,
  ],
  drugs: [/\b(cocaine|heroin|meth|injects?|injecting|overdose|syringe|needle in (his|her))\b/i],
  self_harm: [/\b(self[- ]harm|cutting|suicide|takes? her life|jumps off|slits her wrists)\b/i],
  trauma: [/\b(assault|abuse|rape|abused|trafficked|beaten by)\b/i],
};

const COMPLIANT_ALTERNATIVES: Record<SafetyCategory, string[]> = {
  violence: [
    "Imply rather than show — cut to the aftermath (door swings, glass on floor).",
    "Reaction shot of a witness; let the sound carry the action.",
    "Close-up of trembling hands or a dropped object.",
    "Environmental tension — a curtain still moving, a chair pushed back.",
  ],
  weapons: [
    "Don't render the weapon — render its consequence (a stain, a hand recoiling).",
    "Show a holster or sheath; let the threat live off-screen.",
    "Hands moving toward / away from an object the camera never quite sees.",
  ],
  sexual: [
    "Imply intimacy via fabric, light through curtains, a held breath.",
    "Cut to morning-after staging — rumpled sheet, a half-empty glass.",
    "Frame just the hand or shoulder — withhold the body.",
  ],
  nudity: [
    "Shoulder / collarbone framing only; never below.",
    "Backlit silhouette through frosted glass.",
    "Cut to a robe being tied, the room half-dark.",
  ],
  minors: [
    "Re-cast as ambiguous age or imply via voice + objects only — no on-screen minor in a sensitive frame.",
    "If the character is a minor in story, stage the shot so the child is OFF-SCREEN entirely.",
  ],
  drugs: [
    "Show the prep — a glass, a pill bottle, a closed hand. Never the act of consumption.",
    "Aftermath — disorientation, an empty bottle, blurred environment.",
    "Hands tightening / releasing as a behavioural beat.",
  ],
  self_harm: [
    "Stay in the room before and after, never the act.",
    "Sound design + closed door; a glass of water knocked over.",
    "Reaction shot of a person finding evidence later.",
  ],
  trauma: [
    "Aftermath staging only — no depiction of the event itself.",
    "Hands, breath, refusal to make eye contact.",
    "Environmental quiet — the world continues; the character does not.",
  ],
};

export interface SafetyScanResult {
  flagged: boolean;
  categories: SafetyCategory[];
  evidence: Array<{ category: SafetyCategory; quote: string }>;
  suggestedAlternatives: string[];
}

/**
 * Scan a chunk of brief / action text for flagged categories. Returns a
 * structured warning the router attaches to every prompt derived from the
 * brief. Conservative by design — false-positives are preferable here.
 */
export function scanForSafety(text: string): SafetyScanResult {
  const seen = new Set<SafetyCategory>();
  const evidence: Array<{ category: SafetyCategory; quote: string }> = [];
  for (const [cat, patterns] of Object.entries(TELLS) as Array<[SafetyCategory, RegExp[]]>) {
    for (const re of patterns) {
      const m = text.match(re);
      if (m && m[0]) {
        seen.add(cat);
        if (evidence.length < 6) {
          evidence.push({ category: cat, quote: m[0] });
        }
        break;
      }
    }
  }
  const categories = [...seen];
  const suggested = new Set<string>();
  for (const c of categories) {
    for (const s of COMPLIANT_ALTERNATIVES[c] ?? []) suggested.add(s);
  }
  return {
    flagged: categories.length > 0,
    categories,
    evidence,
    suggestedAlternatives: [...suggested].slice(0, 6),
  };
}
