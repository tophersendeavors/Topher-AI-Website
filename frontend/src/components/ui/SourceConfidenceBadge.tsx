// Source-confidence pill. Four states:
//   source_confirmed       — directly supported by approved source material
//   conservative_inference — fair emotional / thematic extrapolation
//   speculative            — invention not in source; needs writer approval
//   not_enough_source      — agent couldn't infer; user must supply input
//
// Any AI-generated content can wear this. Buyer-facing exports should
// only carry source_confirmed or conservative_inference.

export type SourceConfidence =
  | "source_confirmed"
  | "conservative_inference"
  | "speculative"
  | "not_enough_source";

const LABEL: Record<SourceConfidence, string> = {
  source_confirmed: "source-confirmed",
  conservative_inference: "conservative inference",
  speculative: "speculative · needs approval",
  not_enough_source: "not enough source data",
};

const STYLE: Record<SourceConfidence, string> = {
  source_confirmed: "border-emerald-700/40 bg-emerald-900/20 text-emerald-200",
  conservative_inference: "border-sky-700/40 bg-sky-900/20 text-sky-200",
  speculative: "border-amber-700/40 bg-amber-900/20 text-amber-200",
  not_enough_source: "border-white/10 bg-white/[0.03] text-bone-400",
};

export function SourceConfidenceBadge({
  confidence,
  className,
}: {
  confidence: SourceConfidence;
  className?: string;
}) {
  return (
    <span className={`chip ${STYLE[confidence]} ${className ?? ""}`}>{LABEL[confidence]}</span>
  );
}
