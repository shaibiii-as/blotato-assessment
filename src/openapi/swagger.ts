import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  commentNodeSchema,
  errorResponseSchema,
  postSchema,
} from "./schemas.js";

export async function registerSwagger(app: FastifyInstance): Promise<void> {
  app.addSchema({
    $id: "ErrorResponse",
    ...errorResponseSchema,
  });

  app.addSchema({
    $id: "Post",
    ...postSchema,
  });

  app.addSchema({
    $id: "CommentNode",
    ...commentNodeSchema,
    properties: {
      ...commentNodeSchema.properties,
      replies: {
        type: "array",
        items: { $ref: "CommentNode#" },
      },
    },
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Blotato Comment System API",
        description:
          "Multi-platform comment retrieval and reply API for a social media scheduling product. Platforms (Twitter, Instagram, YouTube) are stubbed.",
        version: "1.0.0",
      },
      tags: [
        { name: "Health", description: "Liveness" },
        { name: "Posts", description: "Published posts" },
        { name: "Comments", description: "Comment list, reply, and retry" },
      ],
      servers: [
        {
          url: `http://localhost:${process.env.PORT ?? "5000"}`,
          description: "Local development",
        },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      tryItOutEnabled: true,
    },
    staticCSP: true,
  });
}
