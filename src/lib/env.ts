/**
 * Safe env reader that works in both Vite (browser) and plain Node.
 *
 * - In a Vite-built bundle `import.meta.env` is a real object.
 * - Under `tsx` / Node it's undefined, so we fall back to `process.env`.
 */
export function readEnv(key: string): string | undefined {
  try {
    const viteEnv = (import.meta as unknown as { env?: Record<string, string> })
      .env;
    if (viteEnv && typeof viteEnv[key] === "string") return viteEnv[key];
  } catch {
    /* import.meta.env may throw in older transpilation targets */
  }
  if (typeof process !== "undefined" && process.env && key in process.env) {
    return process.env[key];
  }
  return undefined;
}
