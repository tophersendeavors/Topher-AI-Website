// Studio Owner identity — the account-level creator profile that turns the
// app from "a tool I subscribed to" into "my studio." Stored in Supabase
// auth user_metadata (account-level, migration-free), with name + avatar
// mirrored to the profiles table.

export type StudioRole =
  | "producer"
  | "writer"
  | "director"
  | "showrunner"
  | "executive_producer"
  | "solo_creator";

export const STUDIO_ROLE_LABELS: Record<StudioRole, string> = {
  producer: "Producer",
  writer: "Writer",
  director: "Director",
  showrunner: "Showrunner",
  executive_producer: "Executive Producer",
  solo_creator: "Solo Creator",
};

/** The AI representation of the Studio Owner — the face of the studio. */
export interface CreativeTwin {
  displayName: string;
  /** e.g. "Studio Founder · Showrunner · Creative Architect" */
  titleLine: string;
  /** Uploaded likeness (data URL or storage URL), or null → monogram. */
  avatarUrl: string | null;
}

export interface StudioOwnerIdentity {
  name: string;
  role: StudioRole | null;
  bio: string;
  avatarUrl: string | null;
  creativeTwin: CreativeTwin | null;
  onboardingComplete: boolean;
  /** Forward-compat for later phases (Creative DNA interview, Studio Builder).
   *  Not populated in Phase 1. */
  creativeDNA?: Record<string, unknown> | null;
  studioConfig?: Record<string, unknown> | null;
  updatedAt: string | null;
}

export interface StudioOwnerResponse {
  owner: StudioOwnerIdentity;
}

// ---------------------------------------------------------------------------
// Studio Builder — the creator designs their own studio (Phase 3). The
// approved design becomes the permanent home and later drives cinematic
// lot + logo image generation.
// ---------------------------------------------------------------------------

export type StudioStyle =
  | "classic_hollywood"
  | "modern_luxury"
  | "futuristic"
  | "rustic"
  | "coastal"
  | "european"
  | "minimalist"
  | "theme_park"
  | "fantasy"
  | "industrial";

export type StudioLocation =
  | "los_angeles"
  | "malibu"
  | "mountains"
  | "forest"
  | "desert"
  | "island"
  | "europe"
  | "tokyo";

export type StudioAtmosphere =
  | "inspirational"
  | "prestigious"
  | "cozy"
  | "grand"
  | "magical"
  | "innovative"
  | "artistic"
  | "bold";

export type StudioScale = "boutique" | "independent" | "mid_size" | "major_studio" | "empire";

export const STUDIO_STYLE_LABELS: Record<StudioStyle, string> = {
  classic_hollywood: "Classic Hollywood",
  modern_luxury: "Modern Luxury",
  futuristic: "Futuristic",
  rustic: "Rustic",
  coastal: "Coastal",
  european: "European",
  minimalist: "Minimalist",
  theme_park: "Theme Park",
  fantasy: "Fantasy",
  industrial: "Industrial",
};
export const STUDIO_LOCATION_LABELS: Record<StudioLocation, string> = {
  los_angeles: "Los Angeles",
  malibu: "Malibu",
  mountains: "Mountains",
  forest: "Forest",
  desert: "Desert",
  island: "Island",
  europe: "Europe",
  tokyo: "Tokyo",
};
export const STUDIO_ATMOSPHERE_LABELS: Record<StudioAtmosphere, string> = {
  inspirational: "Inspirational",
  prestigious: "Prestigious",
  cozy: "Cozy",
  grand: "Grand",
  magical: "Magical",
  innovative: "Innovative",
  artistic: "Artistic",
  bold: "Bold",
};
export const STUDIO_SCALE_LABELS: Record<StudioScale, string> = {
  boutique: "Boutique",
  independent: "Independent",
  mid_size: "Mid-size",
  major_studio: "Major Studio",
  empire: "Empire",
};

export interface StudioPreferences {
  style: StudioStyle | null;
  location: StudioLocation | null;
  atmosphere: StudioAtmosphere[];
  scale: StudioScale | null;
}

/** One generated studio concept the creator can approve or regenerate. */
export interface StudioConcept {
  id: string;
  name: string;
  tagline: string;
  /** 2-3 sentences: what this studio feels like. */
  identity: string;
  /** Visual direction — seeds the later cinematic lot + logo generation. */
  visualDirection: string;
}

export interface StudioConfig {
  preferences: StudioPreferences;
  concepts: StudioConcept[];
  approvedConceptId: string | null;
  approvedAt: string | null;
  /** Populated later by image generation (Phase: cinematic lot). */
  logoUrl?: string | null;
  heroImageUrl?: string | null;
  updatedAt: string | null;
}

export interface StudioConfigResponse {
  config: StudioConfig | null;
}

