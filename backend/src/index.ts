import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import sensible from "@fastify/sensible";
import { config } from "./config.js";
import { registerAuth } from "./auth/verifyJwt.js";

import projectsRoutes from "./routes/projects.js";
import workflowsRoutes from "./routes/workflows.js";
import agentsRoutes from "./routes/agents.js";
import memoryRoutes from "./routes/memory.js";
import scriptsRoutes from "./routes/scripts.js";
import exportsRoutes from "./routes/exports.js";
import productionRoutes from "./routes/production.js";
import entitiesRoutes from "./routes/entities.js";
import emotionalRoutes from "./routes/emotional.js";

async function main() {
  const app = Fastify({
    logger:
      config.NODE_ENV === "production"
        ? { level: "info" }
        : { level: "info", transport: { target: "pino-pretty" } },
    bodyLimit: 8 * 1024 * 1024, // 8 MB — screenplays can be big
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.CORS_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true,
  });
  await app.register(sensible);
  await registerAuth(app);

  app.get("/health", async () => ({ ok: true, env: config.NODE_ENV }));

  await app.register(
    async (api) => {
      await api.register(projectsRoutes);
      await api.register(workflowsRoutes);
      await api.register(agentsRoutes);
      await api.register(memoryRoutes);
      await api.register(scriptsRoutes);
      await api.register(exportsRoutes);
      await api.register(productionRoutes);
      await api.register(entitiesRoutes);
      await api.register(emotionalRoutes);
    },
    { prefix: "/api" }
  );

  app.setErrorHandler((err, _req, reply) => {
    const status = (err as Error & { statusCode?: number }).statusCode ?? 500;
    reply.code(status).send({
      error: err.message,
      ...(config.NODE_ENV === "development" ? { stack: err.stack } : {}),
    });
  });

  try {
    await app.listen({ host: "0.0.0.0", port: config.PORT });
    app.log.info(`TOBURT backend listening on :${config.PORT}`);
  } catch (e) {
    app.log.error(e);
    process.exit(1);
  }
}

main();
