export type GarmentType =
  | "t-shirt"
  | "hoodie"
  | "sweatshirt"
  | "sweatpants"
  | "jeans"
  | "denim-jacket"
  | "long-sleeve"
  | "cap"
  | "tote";

export const GARMENT_TYPES: GarmentType[] = [
  "t-shirt",
  "hoodie",
  "sweatshirt",
  "sweatpants",
  "jeans",
  "denim-jacket",
  "long-sleeve",
  "cap",
  "tote",
];

export type DesignStage =
  | "concept"
  | "prompt"
  | "generated"
  | "print-check"
  | "approved"
  | "exported";

export const DESIGN_STAGES: DesignStage[] = [
  "concept",
  "prompt",
  "generated",
  "print-check",
  "approved",
  "exported",
];

export type DesignStatus = "draft" | "saved" | "approved" | "rejected";

export type Placement =
  | "front-chest"
  | "left-chest"
  | "full-back"
  | "sleeve"
  | "hip"
  | "thigh"
  | "hood"
  | "all-over";

export interface PrintSize {
  widthInches: number;
  heightInches: number;
}

export interface PrintReadinessCheck {
  transparentBackground: boolean;
  correctPixelSize: boolean;
  highContrast: boolean;
  noThinUnreadableLines: boolean;
  noTinyFailureDetails: boolean;
  noCopyrightedTerms: boolean;
  suitableForGarmentPrinting: boolean;
  exportFileAvailable: boolean;
}

export interface Design {
  id: string;
  createdAt: string;
  generatedFor: string;
  title: string;
  garmentType: GarmentType;
  visualDirection: string;
  colorPalette: string[];
  placement: Placement;
  printSize: PrintSize;
  prompt: string;
  heatTransferNotes: string;
  trendTags: string[];
  stage: DesignStage;
  status: DesignStatus;
  approved: boolean;
  readyForNinjaTransfers: boolean;
  notes: string;
  artwork: {
    svg: string;
    pngDataUrl?: string;
    seed: number;
  };
  printCheck: PrintReadinessCheck;
}

export interface BrandSettings {
  brandName: string;
  voice: string;
  palette: string[];
  forbiddenTerms: string[];
  preferredGarments: GarmentType[];
  defaultPlacement: Placement;
  signaturePromptSuffix: string;
}

export const DEFAULT_BRAND_SETTINGS: BrandSettings = {
  brandName: "ASH KROW",
  voice:
    "Dark luxury streetwear. Minimal but emotionally charged. Distressed typography. Gritty but premium. Not cartoonish, not childish, not generic AI art.",
  palette: [
    "#0a0a0a",
    "#e9e3d6",
    "#8a8a8a",
    "#f5f1e8",
    "#7a0a0a",
    "#c8ccd1",
    "#5b6f86",
  ],
  forbiddenTerms: [
    "nike",
    "chrome hearts",
    "balenciaga",
    "vetements",
    "rick owens",
    "supreme",
    "off-white",
    "fear of god",
    "louis vuitton",
    "gucci",
    "yeezy",
    "travis scott",
    "kanye",
    "drake",
  ],
  preferredGarments: ["t-shirt", "hoodie", "sweatshirt", "denim-jacket"],
  defaultPlacement: "front-chest",
  signaturePromptSuffix:
    "high-contrast monochrome with selective blood-red accents, gritty halftone texture, distressed serif typography, runway-grade streetwear print, transparent background, no garment in frame, no mockup",
};
