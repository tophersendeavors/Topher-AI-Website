/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_IMAGE_API_PROVIDER?: string;
  readonly VITE_IMAGE_API_URL?: string;
  readonly VITE_IMAGE_API_KEY?: string;
  readonly VITE_IMAGE_API_MODEL?: string;
  readonly VITE_TREND_API_URL?: string;
  readonly VITE_TREND_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
