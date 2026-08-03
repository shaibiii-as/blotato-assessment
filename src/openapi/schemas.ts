/** Shared OpenAPI / JSON Schema fragments for Swagger. */

export const errorResponseSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
    },
  },
} as const;

export const platformSchema = {
  type: "string",
  enum: ["TWITTER", "INSTAGRAM", "YOUTUBE"],
} as const;

export const commentStatusSchema = {
  type: "string",
  enum: ["SYNCED", "PENDING_PUBLISH", "FAILED"],
} as const;

export const postSchema = {
  type: "object",
  required: [
    "id",
    "platform",
    "externalPostId",
    "publishedAt",
    "accountDisplayName",
    "workspaceId",
    "commentCount",
  ],
  properties: {
    id: { type: "string" },
    platform: platformSchema,
    caption: { type: ["string", "null"] },
    externalPostId: { type: "string" },
    publishedAt: { type: "string", format: "date-time" },
    lastSyncedAt: { type: ["string", "null"], format: "date-time" },
    accountDisplayName: { type: "string" },
    workspaceId: { type: "string" },
    commentCount: { type: "integer" },
  },
} as const;

/** Recursive comment tree node. */
export const commentNodeSchema = {
  type: "object",
  required: [
    "id",
    "postId",
    "depth",
    "body",
    "authorHandle",
    "isOurs",
    "status",
    "retryCount",
    "createdAt",
    "canReply",
    "replies",
  ],
  properties: {
    id: { type: "string" },
    postId: { type: "string" },
    parentCommentId: { type: ["string", "null"] },
    rootCommentId: { type: ["string", "null"] },
    depth: { type: "integer" },
    body: { type: "string" },
    authorHandle: { type: "string" },
    authorExternalId: { type: ["string", "null"] },
    isOurs: { type: "boolean" },
    status: commentStatusSchema,
    externalCommentId: { type: ["string", "null"] },
    failReason: { type: ["string", "null"] },
    retryCount: { type: "integer" },
    createdAt: { type: "string", format: "date-time" },
    canReply: { type: "boolean" },
    replies: {
      type: "array",
      items: { type: "object" },
      description: "Nested replies (see CommentNode)",
    },
  },
} as const;

export const standardErrorResponses = {
  400: {
    description: "Bad request / validation / platform validation",
    content: {
      "application/json": { schema: errorResponseSchema },
    },
  },
  404: {
    description: "Resource not found",
    content: {
      "application/json": { schema: errorResponseSchema },
    },
  },
  502: {
    description: "Platform / upstream error",
    content: {
      "application/json": { schema: errorResponseSchema },
    },
  },
  500: {
    description: "Internal server error",
    content: {
      "application/json": { schema: errorResponseSchema },
    },
  },
} as const;
