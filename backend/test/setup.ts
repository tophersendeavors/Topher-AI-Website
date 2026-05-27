// Default env shared by every test. Individual tests may override.
process.env.NODE_ENV ??= "test";
process.env.PORT ??= "0";
process.env.CORS_ORIGIN ??= "http://localhost:5173";
process.env.SUPABASE_URL ??= "https://test.supabase.co";
process.env.SUPABASE_ANON_KEY ??= "test-anon-key-aaaaaaaaaaaaaaaaaaaaaa";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "test-service-role-key-bbbbbbbbbbbbbbbbbbbb";
process.env.SUPABASE_JWT_SECRET ??= "test-jwt-secret-min-10";

// Stub LLM keys: not set on purpose. The provider falls back to a
// deterministic stub when no key is configured (see llm/provider.ts).
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
