import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import sensible from "@fastify/sensible";
import { config } from "./config.js";
import { supabase } from "./db/client.js";
import { registerAuth } from "./auth/verifyJwt.js";

import projectsRoutes from "./routes/projects.js";
import workflowsRoutes from "./routes/workflows.js";
import agentsRoutes from "./routes/agents.js";
import memoryRoutes from "./routes/memory.js";
import scriptsRoutes from "./routes/scripts.js";
import scriptScenesRoutes from "./routes/scriptScenes.js";
import exportsRoutes from "./routes/exports.js";
import productionRoutes from "./routes/production.js";
import entitiesRoutes from "./routes/entities.js";
import continuityRoutes from "./routes/continuity.js";
import productionDesignRoutes from "./routes/productionDesign.js";
import emotionalRoutes from "./routes/emotional.js";
import pitchRoutes from "./routes/pitch.js";
import preflightRoutes from "./routes/preflight.js";
import departmentRoutes from "./routes/departments.js";
import workflowRoutes from "./routes/workflow.js";
import redevelopmentRoutes from "./routes/redevelopment.js";

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
      await api.register(scriptScenesRoutes);
      await api.register(exportsRoutes);
      await api.register(productionRoutes);
      await api.register(entitiesRoutes);
      await api.register(continuityRoutes);
      await api.register(productionDesignRoutes);
      await api.register(emotionalRoutes);
      await api.register(pitchRoutes);
      await api.register(preflightRoutes);
      await api.register(departmentRoutes);
      await api.register(workflowRoutes);
      await api.register(redevelopmentRoutes);
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

  // Recover from prior-process orphans: any script_scenes row left at
  // `status='generating'` from a previous boot is unreachable now (the LLM
  // call that owned it died with that process). Reset to `pending` so the
  // user can re-trigger it from the UI.
  try {
    const { data: stuck, error } = await supabase
      .from("script_scenes")
      .update({
        status: "pending",
        notes: "Reset on boot — server restarted mid-generation",
      })
      .eq("status", "generating")
      .select("id, ord");
    if (error) {
      app.log.warn({ err: error }, "scene_scenes stuck-reset failed");
    } else if (stuck && stuck.length > 0) {
      app.log.info(
        `[boot] reset ${stuck.length} orphaned script_scenes from generating → pending`
      );
    }
  } catch (e) {
    app.log.warn({ err: e }, "scene_scenes stuck-reset threw");
  }

  try {
    await app.listen({ host: "0.0.0.0", port: config.PORT });
    app.log.info(`TOBURT backend listening on :${config.PORT}`);
  } catch (e) {
    app.log.error(e);
    process.exit(1);
  }
}

main();
