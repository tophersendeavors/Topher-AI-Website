import type { FastifyRequest } from "fastify";
import jwt from "@fastify/jwt";
import { config } from "../config.js";

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export async function registerAuth(app: import("fastify").FastifyInstance) {
  await app.register(jwt, {
    secret: config.SUPABASE_JWT_SECRET,
    verify: { algorithms: ["HS256"] },
  });

  app.decorateRequest("user", undefined);
}

/**
 * Extract & verify the Supabase JWT from a request.
 * Throws 401 if missing/invalid.
 */
export async function requireUser(req: FastifyRequest): Promise<AuthUser> {
  if (req.user) return req.user;

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
    req.user = user;
    return user;
  } catch {
    const err = new Error("Invalid token");
    (err as Error & { statusCode?: number }).statusCode = 401;
    throw err;
  }
}
