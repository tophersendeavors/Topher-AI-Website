# Deployment

## Prerequisites

- Node 20+, npm 10+
- Supabase project (cloud) **or** local Supabase CLI install
- One of:
  - `ANTHROPIC_API_KEY` (recommended for default models)
  - `OPENAI_API_KEY` (used for embeddings + optional model fallback)

---

## 1. Supabase setup

### Option A — Cloud

1. Create a new project at https://supabase.com.
2. In **Database → Extensions**, enable `vector`.
3. In **Settings → API**, copy the URL, anon key, service role key, JWT
   secret.
4. Apply the schema:

```bash
# from repo root
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

5. In **Storage**, create the buckets `screenplay-exports`, `production-assets`
   (both private).
6. In **Authentication**, enable email + any social providers you want.

### Option B — Local

```bash
npm install -g supabase
supabase start
supabase db reset           # applies migrations + seed
```

The CLI prints local URLs and keys; copy into `.env`.

---

## 2. Backend

```bash
cd backend
cp ../.env.example .env
# fill in SUPABASE_* and at least one LLM key
npm install
npm run dev                 # http://localhost:8787
```

For production:

```bash
npm run build
node dist/index.js
```

The backend is stateless — run it behind any TLS terminator (Fly.io, Render,
Cloud Run, ECS). Set `CORS_ORIGIN` to your frontend's origin.

---

## 3. Frontend

```bash
cd frontend
cp ../.env.example .env
# fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_BACKEND_URL
npm install
npm run dev                 # http://localhost:5173
```

Production build:

```bash
npm run build               # outputs to frontend/dist
```

Deploy `frontend/dist` to Vercel / Netlify / Cloudflare Pages. Set the
`VITE_*` env vars in the host.

---

## 4. Recommended production topology

```
Cloudflare ──▶ Vercel (frontend/dist)
            ▶ Fly.io / Render (backend, 2+ instances)
            ▶ Supabase (Postgres + Storage + Auth + Realtime)
```

- Put the backend behind a private origin; expose only `/api/*`.
- Use Supabase Realtime for room and approval channels — no need to add
  another websocket layer.
- Set up Supabase nightly backups + PITR.

---

## 5. Smoke tests

```bash
# Health
curl http://localhost:8787/health

# Auth-protected: pass a Supabase JWT
TOKEN=...
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/projects
```
