// Template registry — single source of truth for which RedevProjectTemplate
// instances are available. New templates plug in here.

import type { RedevProjectTemplate, RedevTemplateR6Overlay } from "./types.js";
import { BLANK_TEMPLATE } from "./blank.js";
import { SELVAJE_TEMPLATE, SELVAJE_R6_OVERLAY } from "./selvaje.js";

export * from "./types.js";
export * from "./shared.js";

/** Every registered template. The order here is the order shown in the
 *  project-create UI's "Start from template" picker. */
export const REDEV_TEMPLATES: RedevProjectTemplate[] = [
  BLANK_TEMPLATE,
  SELVAJE_TEMPLATE,
];

/** Lookup by id. Returns the registered template or the `blank` template
 *  as a permissive fallback if the id is unknown. Never throws — the
 *  audits/agents always get a valid template. */
export function getTemplate(templateId: string | null | undefined): RedevProjectTemplate {
  if (!templateId) return BLANK_TEMPLATE;
  return REDEV_TEMPLATES.find((t) => t.templateId === templateId) ?? BLANK_TEMPLATE;
}

/** Resolve the active template for a redevelopment pass. Honors
 *  backward-compat: passes created before this refactor have no
 *  `redevTemplateId` field. For those, we infer SELVAJE (since SELVAJE
 *  is the only pre-existing project) so existing approved work doesn't
 *  start auditing differently overnight. */
export function resolveActiveTemplate(pass: {
  redevTemplateId?: string | null;
}): RedevProjectTemplate {
  if (pass.redevTemplateId) return getTemplate(pass.redevTemplateId);
  return SELVAJE_TEMPLATE;
}

/** R6 overlay registry — only templates that opt in declare a contract
 *  set. Returns null when the template has no overlay. */
export function getR6Overlay(
  template: RedevProjectTemplate
): RedevTemplateR6Overlay | null {
  if (template.templateId === "selvaje") return SELVAJE_R6_OVERLAY;
  return null;
}

export { BLANK_TEMPLATE, SELVAJE_TEMPLATE, SELVAJE_R6_OVERLAY };
