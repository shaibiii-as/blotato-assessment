import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import * as commentService from "../services/commentService.js";
import { standardErrorResponses } from "../openapi/schemas.js";

const listQuerySchema = z.object({
  sync: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .refine((v) => v === undefined || (!Number.isNaN(v) && v > 0), {
      message: "limit must be a positive number",
    }),
});

const replyBodySchema = z.object({
  body: z.string().min(1).max(5000),
});

const postParamsSchema = z.object({
  postId: z.string().min(1),
});

const replyParamsSchema = z.object({
  postId: z.string().min(1),
  commentId: z.string().min(1),
});

export async function commentRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/posts/:postId/comments",
    {
      schema: {
        tags: ["Comments"],
        summary: "List comments for a post",
        description:
          "Returns a nested comment tree. Pass sync=true to refresh from the platform stub first. Pagination (cursor/limit) applies to top-level comments only.",
        params: {
          type: "object",
          required: ["postId"],
          properties: {
            postId: { type: "string", description: "Internal post ID" },
          },
        },
        querystring: {
          type: "object",
          properties: {
            sync: {
              type: "string",
              enum: ["true", "false"],
              description: "If true, sync from the platform before listing",
            },
            cursor: {
              type: "string",
              description: "Last top-level comment ID from the previous page",
            },
            limit: {
              type: "string",
              description: "Max top-level comments (1–100, default 50)",
            },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["data", "nextCursor"],
            properties: {
              data: {
                type: "array",
                items: { $ref: "CommentNode#" },
              },
              nextCursor: { type: ["string", "null"] },
              lastSyncedAt: { type: ["string", "null"], format: "date-time" },
            },
          },
          ...standardErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const params = postParamsSchema.parse(request.params);
      const query = listQuerySchema.parse(request.query);

      const result = await commentService.listComments({
        postId: params.postId,
        sync: query.sync,
        cursor: query.cursor,
        limit: query.limit,
      });

      return reply.send(result);
    },
  );

  app.post(
    "/posts/:postId/comments/:commentId/replies",
    {
      schema: {
        tags: ["Comments"],
        summary: "Reply to a comment",
        description:
          "Creates a local PENDING_PUBLISH comment, publishes via the platform adapter/outbox, then marks SYNCED or FAILED. Only top-level comments accept replies (max depth 1). Optional Idempotency-Key avoids double-posts on retries.",
        params: {
          type: "object",
          required: ["postId", "commentId"],
          properties: {
            postId: { type: "string", description: "Internal post ID" },
            commentId: {
              type: "string",
              description: "Internal ID of the parent comment to reply to",
            },
          },
        },
        headers: {
          type: "object",
          properties: {
            "idempotency-key": {
              type: "string",
              description: "Optional idempotency key (24h TTL, scoped to this route)",
            },
          },
        },
        body: {
          type: "object",
          required: ["body"],
          properties: {
            body: {
              type: "string",
              minLength: 1,
              maxLength: 5000,
              description: "Reply text",
            },
          },
        },
        response: {
          201: {
            type: "object",
            required: ["data"],
            properties: {
              data: { $ref: "CommentNode#" },
            },
          },
          ...standardErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const params = replyParamsSchema.parse(request.params);
      const body = replyBodySchema.parse(request.body);
      const idempotencyKeyHeader = request.headers["idempotency-key"];
      const idempotencyKey =
        typeof idempotencyKeyHeader === "string" ? idempotencyKeyHeader : undefined;

      const comment = await commentService.replyToComment({
        postId: params.postId,
        commentId: params.commentId,
        body: body.body,
        idempotencyKey,
      });

      return reply.status(201).send({ data: comment });
    },
  );

  app.post(
    "/posts/:postId/comments/:commentId/retry",
    {
      schema: {
        tags: ["Comments"],
        summary: "Retry a failed reply",
        description:
          "Re-drives an existing FAILED isOurs reply through the publish outbox. Does not create a new comment row.",
        params: {
          type: "object",
          required: ["postId", "commentId"],
          properties: {
            postId: { type: "string", description: "Internal post ID" },
            commentId: {
              type: "string",
              description: "Internal ID of the failed reply (not the parent)",
            },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["data"],
            properties: {
              data: { $ref: "CommentNode#" },
            },
          },
          ...standardErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const params = replyParamsSchema.parse(request.params);
      const comment = await commentService.retryFailedReply({
        postId: params.postId,
        commentId: params.commentId,
      });
      return reply.send({ data: comment });
    },
  );
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }

    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: error.issues.map((i) => i.message).join("; "),
        },
      });
    }

    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof (error as { statusCode: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;

    requestLogError(error);

    return reply.status(statusCode).send({
      error: {
        code: statusCode >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST",
        message:
          statusCode >= 500
            ? "Internal server error"
            : error instanceof Error
              ? error.message
              : "Bad request",
      },
    });
  });
}

function requestLogError(error: unknown): void {
  console.error("[error]", error);
}
