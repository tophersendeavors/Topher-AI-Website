import type { FastifyInstance, FastifyRequest } from "fastify";
import jwt from "@fastify/jwt";
import { config } from "../config.js";

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

// `@fastify/jwt` already decorates request.user with the decoded payload.
// We keep a separate cache key to expose our normalized AuthUser.
const AUTH_CACHE = new WeakMap<FastifyRequest, AuthUser>();

export async function registerAuth(app: FastifyInstance) {
  await app.register(jwt, {
    secret: config.SUPABASE_JWT_SECRET,
    verify: { algorithms: ["HS256"] },
  });
}

/**
 * Extract & verify the Supabase JWT from a request.
 * Throws 401 if missing/invalid.
 */
export async function requireUser(req: FastifyRequest): Promise<AuthUser> {
  const cached = AUTH_CACHE.get(req);
  if (cached) return cached;

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    const err = new Error("Missing bearer token");
    (err as Error & { statusCode?: number }).statusCode = 401;
    throw err;
  }
  const token = auth.slice("Bearer ".length);

  try {
    const decoded = (await req.server.jwt.verify(token)) as {
      sub: string;
      email?: string;
      role?: string;
    };
    const user: AuthUser = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
    };
    AUTH_CACHE.set(req, user);
    return user;
  } catch {
    const err = new Error("Invalid token");
    (err as Error & { statusCode?: number }).statusCode = 401;
    throw err;
  }
}
