import Fastify from "fastify";
import cors from "@fastify/cors";
import { commentRoutes, registerErrorHandler } from "./routes/comments.js";
import { postRoutes } from "./routes/posts.js";
import { registerSwagger } from "./openapi/swagger.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: true,
  });

  // Swagger must register before routes so schemas are collected.
  await registerSwagger(app);

  registerErrorHandler(app);

  app.get(
    "/health",
    {
      schema: {
        tags: ["Health"],
        summary: "Liveness check",
        description: "Returns OK if the process is running. Does not check the database.",
        response: {
          200: {
            type: "object",
            required: ["status"],
            properties: {
              status: { type: "string", example: "ok" },
            },
          },
        },
      },
    },
    async () => ({ status: "ok" }),
  );

  await app.register(postRoutes);
  await app.register(commentRoutes);

  return app;
}
