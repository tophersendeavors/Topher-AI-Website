import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { config } from "../config.js";

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

const AUTH_CACHE = new WeakMap<FastifyRequest, AuthUser>();

// Resolve the verification material once per process. Supabase issues JWTs
// signed with either:
//   - the legacy HS256 "JWT Secret" (still present on many projects), or
//   - the newer ES256 / RS256 "JWT signing keys" — verified via the project's
//     JWKS endpoint at /auth/v1/.well-known/jwks.json.
//
// We support BOTH. If `SUPABASE_JWT_SECRET` is set to a real value, we use
// HS256 with that secret. Otherwise we fetch the JWKS and verify
// asymmetrically — and we ALWAYS fall back to JWKS on HS256 verification
// failure so newly-rotated keys keep working without a redeploy.

const placeholderSecret =
  !config.SUPABASE_JWT_SECRET ||
  /^YOUR[_-]/i.test(config.SUPABASE_JWT_SECRET) ||
  config.SUPABASE_JWT_SECRET.length < 16;

const hsKey = placeholderSecret
  ? null
  : new TextEncoder().encode(config.SUPABASE_JWT_SECRET);

const jwksUrl = new URL(`${config.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
const remoteJwks: JWTVerifyGetKey = createRemoteJWKSet(jwksUrl, {
  // jose caches keys; small cache window keeps rotation responsive in dev.
  cacheMaxAge: 10 * 60 * 1000,
  cooldownDuration: 30 * 1000,
});

export async function registerAuth(_app: FastifyInstance) {
  // No plugin registration needed — verification happens in requireUser().
}

export async function requireUser(req: FastifyRequest): Promise<AuthUser> {
  const cached = AUTH_CACHE.get(req);
  if (cached) return cached;

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    throwUnauthorized("Missing bearer token");
  }
  const token = auth!.slice("Bearer ".length);

  let payload: JWTPayload;
  try {
    payload = await verifyToken(token);
  } catch (err) {
    throwUnauthorized(
      `Invalid token: ${(err as Error).message ?? "verification failed"}`
    );
  }

  if (!payload!.sub) {
    throwUnauthorized("Token missing `sub` claim");
  }

  const user: AuthUser = {
    id: payload!.sub as string,
    email: payload!.email as string | undefined,
    role: payload!.role as string | undefined,
  };
  AUTH_CACHE.set(req, user);
  return user;
}

/**
 * Try HS256 (if legacy secret is configured) first, then fall back to JWKS.
 * Always returns the decoded payload on success or throws on failure.
 */
async function verifyToken(token: string): Promise<JWTPayload> {
  if (hsKey) {
    try {
      const { payload } = await jwtVerify(token, hsKey, {
        algorithms: ["HS256"],
      });
      return payload;
    } catch {
      // Fall through to JWKS — supports projects that have rotated to
      // asymmetric keys without removing the legacy secret env var.
    }
  }
  const { payload } = await jwtVerify(token, remoteJwks, {
    algorithms: ["RS256", "ES256"],
  });
  return payload;
}

function throwUnauthorized(message: string): never {
  const err = new Error(message);
  (err as Error & { statusCode?: number }).statusCode = 401;
  throw err;
}
