import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { notFound } from "../lib/errors.js";
import { standardErrorResponses } from "../openapi/schemas.js";

function serializePost(post: {
  id: string;
  platform: string;
  caption: string | null;
  externalPostId: string;
  publishedAt: Date;
  lastSyncedAt: Date | null;
  socialAccount: { displayName: string; workspaceId: string };
  _count: { comments: number };
}) {
  return {
    id: post.id,
    platform: post.platform,
    caption: post.caption,
    externalPostId: post.externalPostId,
    publishedAt: post.publishedAt.toISOString(),
    lastSyncedAt: post.lastSyncedAt?.toISOString() ?? null,
    accountDisplayName: post.socialAccount.displayName,
    workspaceId: post.socialAccount.workspaceId,
    commentCount: post._count.comments,
  };
}

const postInclude = {
  socialAccount: {
    select: { displayName: true, externalAccountId: true, workspaceId: true },
  },
  _count: { select: { comments: true } },
} as const;

export async function postRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/posts",
    {
      schema: {
        tags: ["Posts"],
        summary: "List published posts",
        description:
          "Returns all published posts, newest publishedAt first. Use a post id with the comment endpoints.",
        response: {
          200: {
            type: "object",
            required: ["data"],
            properties: {
              data: {
                type: "array",
                items: { $ref: "Post#" },
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const posts = await prisma.post.findMany({
        orderBy: { publishedAt: "desc" },
        include: postInclude,
      });

      return reply.send({
        data: posts.map(serializePost),
      });
    },
  );

  app.get(
    "/posts/:postId",
    {
      schema: {
        tags: ["Posts"],
        summary: "Get a post by ID",
        description: "Fetch one published post by its internal ID.",
        params: {
          type: "object",
          required: ["postId"],
          properties: {
            postId: { type: "string", description: "Internal post ID" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["data"],
            properties: {
              data: { $ref: "Post#" },
            },
          },
          ...standardErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const { postId } = z.object({ postId: z.string().min(1) }).parse(request.params);

      const post = await prisma.post.findUnique({
        where: { id: postId },
        include: postInclude,
      });

      if (!post) {
        throw notFound(`Post not found: ${postId}`);
      }

      return reply.send({ data: serializePost(post) });
    },
  );
}
