import type { Design, PrintReadinessCheck } from "@/types";

const PRINT_CHECK_LABELS: Record<keyof PrintReadinessCheck, string> = {
  transparentBackground: "Transparent background",
  correctPixelSize: "Correct pixel size (≥ 4500px @ 300dpi equiv.)",
  highContrast: "High contrast against garment",
  noThinUnreadableLines: "No thin unreadable lines",
  noTinyFailureDetails: "No tiny details that may fail in heat transfer",
  noCopyrightedTerms: "No copyrighted / trademarked terms",
  suitableForGarmentPrinting: "Suitable for garment printing",
  exportFileAvailable: "Export file available",
};

export function getPrintCheckLabel(key: keyof PrintReadinessCheck): string {
  return PRINT_CHECK_LABELS[key];
}

export function runPrintReadiness(
  design: Design,
  forbiddenTerms: string[],
): PrintReadinessCheck {
  const haystack = `${design.title} ${design.prompt} ${design.visualDirection}`.toLowerCase();
  const noCopyrightedTerms = !forbiddenTerms.some((t) =>
    haystack.includes(t.toLowerCase()),
  );

  const minSidePx = Math.min(
    design.printSize.widthInches * 300,
    design.printSize.heightInches * 300,
  );

  return {
    transparentBackground: design.artwork.svg.includes("data-transparent"),
    correctPixelSize:
      design.printSize.widthInches * 300 >= 4500 || minSidePx >= 4500,
    highContrast: design.colorPalette.length >= 2,
    noThinUnreadableLines: !/stroke-width="0?\.[0-4]"/.test(design.artwork.svg),
    noTinyFailureDetails: !design.artwork.svg.includes("font-size=\"1\""),
    noCopyrightedTerms,
    suitableForGarmentPrinting: design.printSize.widthInches <= 16,
    exportFileAvailable: Boolean(design.artwork.svg),
  };
}

export function isPrintReady(check: PrintReadinessCheck): boolean {
  return Object.values(check).every(Boolean);
}

export function printCheckScore(check: PrintReadinessCheck): number {
  const values = Object.values(check);
  return Math.round((values.filter(Boolean).length / values.length) * 100);
}
