import type { Comment, Post, SocialAccount } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { getAdapter } from "../platforms/registry.js";
import type { ExternalComment } from "../platforms/types.js";
import {
  AppError,
  badRequest,
  notFound,
  platformError,
} from "../lib/errors.js";

export interface CommentNode {
  id: string;
  postId: string;
  parentCommentId: string | null;
  rootCommentId: string | null;
  depth: number;
  body: string;
  authorHandle: string;
  authorExternalId: string | null;
  isOurs: boolean;
  status: Comment["status"];
  externalCommentId: string | null;
  failReason: string | null;
  retryCount: number;
  createdAt: string;
  canReply: boolean;
  replies: CommentNode[];
}

export interface ListCommentsResult {
  data: CommentNode[];
  nextCursor: string | null;
  lastSyncedAt: string | null;
}

type PostWithAccount = Post & { socialAccount: SocialAccount };

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const REPLY_IDEMPOTENCY_SCOPE = "POST:/posts/:postId/comments/:commentId/replies";

function toNode(
  comment: Comment,
  canReply: boolean,
  replies: CommentNode[] = [],
): CommentNode {
  return {
    id: comment.id,
    postId: comment.postId,
    parentCommentId: comment.parentCommentId,
    rootCommentId: comment.rootCommentId,
    depth: comment.depth,
    body: comment.body,
    authorHandle: comment.authorHandle,
    authorExternalId: comment.authorExternalId,
    isOurs: comment.isOurs,
    status: comment.status,
    externalCommentId: comment.externalCommentId,
    failReason: comment.failReason,
    retryCount: comment.retryCount,
    createdAt: comment.createdAt.toISOString(),
    canReply,
    replies,
  };
}

function buildTree(comments: Comment[], maxReplyDepth: number): CommentNode[] {
  const byId = new Map<string, CommentNode>();

  for (const c of comments) {
    const canReply =
      Boolean(c.externalCommentId) &&
      c.status === "SYNCED" &&
      c.depth < maxReplyDepth;
    byId.set(c.id, toNode(c, canReply));
  }

  const roots: CommentNode[] = [];
  for (const c of comments) {
    const node = byId.get(c.id)!;
    if (c.parentCommentId && byId.has(c.parentCommentId)) {
      byId.get(c.parentCommentId)!.replies.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRecursive = (nodes: CommentNode[]) => {
    nodes.sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    for (const n of nodes) sortRecursive(n.replies);
  };
  sortRecursive(roots);
  return roots;
}

async function loadPostOrThrow(postId: string): Promise<PostWithAccount> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { socialAccount: true },
  });
  if (!post) {
    throw notFound(`Post not found: ${postId}`);
  }
  return post;
}

async function readIdempotentResponse(
  scope: string,
  key: string,
): Promise<CommentNode | null> {
  const existing = await prisma.idempotencyKey.findUnique({
    where: { scope_key: { scope, key } },
  });
  if (!existing) return null;
  if (existing.expiresAt.getTime() < Date.now()) {
    await prisma.idempotencyKey.delete({ where: { id: existing.id } });
    return null;
  }
  return JSON.parse(existing.response) as CommentNode;
}

async function storeIdempotentResponse(
  scope: string,
  key: string,
  node: CommentNode,
): Promise<void> {
  await prisma.idempotencyKey.upsert({
    where: { scope_key: { scope, key } },
    create: {
      scope,
      key,
      response: JSON.stringify(node),
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    },
    update: {
      response: JSON.stringify(node),
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    },
  });
}

/**
 * Upsert remote comments in one transaction.
 * Uses denormalized depth + rootCommentId; matches by (postId, externalCommentId).
 */
export async function syncCommentsFromPlatform(
  post: PostWithAccount,
): Promise<void> {
  const adapter = getAdapter(post.platform);
  let remote: ExternalComment[];
  try {
    remote = await adapter.listComments({
      externalPostId: post.externalPostId,
      account: post.socialAccount,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : "Unknown platform error";
    throw platformError(`Failed to list comments from ${post.platform}: ${message}`);
  }

  await prisma.$transaction(async (tx) => {
    const externalToInternal = new Map<string, string>();

    // Pass 1: upsert rows (parents may not be linked yet).
    for (const ext of remote) {
      const existing = await tx.comment.findFirst({
        where: {
          postId: post.id,
          externalCommentId: ext.externalCommentId,
        },
      });

      if (existing) {
        const updated = await tx.comment.update({
          where: { id: existing.id },
          data: {
            body: ext.body,
            authorHandle: ext.authorHandle,
            authorExternalId: ext.authorExternalId,
            status: "SYNCED",
            failReason: null,
            platformRaw: ext.platformRaw ? JSON.stringify(ext.platformRaw) : null,
            createdAt: ext.createdAt,
          },
        });
        externalToInternal.set(ext.externalCommentId, updated.id);
      } else {
        const created = await tx.comment.create({
          data: {
            postId: post.id,
            externalCommentId: ext.externalCommentId,
            authorHandle: ext.authorHandle,
            authorExternalId: ext.authorExternalId,
            body: ext.body,
            isOurs: false,
            status: "SYNCED",
            depth: 0,
            platformRaw: ext.platformRaw ? JSON.stringify(ext.platformRaw) : null,
            createdAt: ext.createdAt,
          },
        });
        // Top-level until parents are wired; root points at self for now.
        await tx.comment.update({
          where: { id: created.id },
          data: { rootCommentId: created.id },
        });
        externalToInternal.set(ext.externalCommentId, created.id);
      }
    }

    // Pass 2: parent links + depth + root.
    for (const ext of remote) {
      const childId = externalToInternal.get(ext.externalCommentId);
      if (!childId) continue;

      if (!ext.parentExternalCommentId) {
        await tx.comment.update({
          where: { id: childId },
          data: {
            parentCommentId: null,
            depth: 0,
            rootCommentId: childId,
          },
        });
        continue;
      }

      const parentId = externalToInternal.get(ext.parentExternalCommentId);
      if (!parentId) continue;

      const parent = await tx.comment.findUniqueOrThrow({
        where: { id: parentId },
      });
      const rootId = parent.rootCommentId ?? parent.id;

      await tx.comment.update({
        where: { id: childId },
        data: {
          parentCommentId: parentId,
          depth: parent.depth + 1,
          rootCommentId: rootId,
        },
      });
    }

    await tx.post.update({
      where: { id: post.id },
      data: { lastSyncedAt: new Date() },
    });
  });
}

export async function listComments(params: {
  postId: string;
  sync?: boolean;
  cursor?: string;
  limit?: number;
}): Promise<ListCommentsResult> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);
  const post = await loadPostOrThrow(params.postId);
  const adapter = getAdapter(post.platform);

  if (params.sync) {
    await syncCommentsFromPlatform(post);
  }

  const refreshed = await loadPostOrThrow(params.postId);

  // Keyset pagination over top-level comments: cursor = last root id.
  const all = await prisma.comment.findMany({
    where: { postId: post.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const tree = buildTree(all, adapter.maxReplyDepth);
  let start = 0;
  if (params.cursor) {
    const idx = tree.findIndex((n) => n.id === params.cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }
  const page = tree.slice(start, start + limit);
  const nextCursor =
    start + limit < tree.length ? (page[page.length - 1]?.id ?? null) : null;

  return {
    data: page,
    nextCursor,
    lastSyncedAt: refreshed.lastSyncedAt?.toISOString() ?? null,
  };
}

async function publishReplyToPlatform(params: {
  post: PostWithAccount;
  pending: Comment;
  parent: Comment;
}): Promise<Comment> {
  const { post, pending, parent } = params;
  const adapter = getAdapter(post.platform);

  if (!parent.externalCommentId) {
    throw badRequest(
      "Cannot reply to a comment that has not been published to the platform yet",
    );
  }

  await prisma.publishOutbox.upsert({
    where: { commentId: pending.id },
    create: {
      postId: post.id,
      commentId: pending.id,
      status: "PROCESSING",
      attempts: 1,
      availableAt: new Date(),
    },
    update: {
      status: "PROCESSING",
      attempts: { increment: 1 },
      lastError: null,
    },
  });

  try {
    const platformReply = await adapter.replyToComment({
      externalPostId: post.externalPostId,
      externalCommentId: parent.externalCommentId,
      body: pending.body,
      account: post.socialAccount,
    });

    const synced = await prisma.$transaction(async (tx) => {
      const updated = await tx.comment.update({
        where: { id: pending.id },
        data: {
          externalCommentId: platformReply.externalCommentId,
          authorHandle: platformReply.authorHandle,
          authorExternalId: platformReply.authorExternalId,
          status: "SYNCED",
          failReason: null,
          createdAt: platformReply.createdAt,
        },
      });
      await tx.publishOutbox.update({
        where: { commentId: pending.id },
        data: { status: "COMPLETED", lastError: null },
      });
      return updated;
    });

    return synced;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown platform error";
    await prisma.$transaction(async (tx) => {
      await tx.comment.update({
        where: { id: pending.id },
        data: {
          status: "FAILED",
          failReason: message,
          retryCount: { increment: 1 },
        },
      });
      await tx.publishOutbox.update({
        where: { commentId: pending.id },
        data: {
          status: "FAILED",
          lastError: message,
          availableAt: new Date(Date.now() + 30_000),
        },
      });
    });

    if (err instanceof AppError) throw err;
    throw platformError(`Failed to publish reply to ${post.platform}: ${message}`);
  }
}

export async function replyToComment(params: {
  postId: string;
  commentId: string;
  body: string;
  idempotencyKey?: string;
}): Promise<CommentNode> {
  const body = params.body.trim();
  if (!body) {
    throw badRequest("Reply body must not be empty");
  }
  if (body.length > 5000) {
    throw badRequest("Reply body exceeds maximum length of 5000 characters");
  }

  const scope = REPLY_IDEMPOTENCY_SCOPE;
  if (params.idempotencyKey) {
    const cached = await readIdempotentResponse(scope, params.idempotencyKey);
    if (cached) return cached;
  }

  const post = await loadPostOrThrow(params.postId);
  const adapter = getAdapter(post.platform);
  const parent = await prisma.comment.findFirst({
    where: { id: params.commentId, postId: post.id },
  });
  if (!parent) {
    throw notFound(`Comment not found on post: ${params.commentId}`);
  }
  if (!parent.externalCommentId || parent.status !== "SYNCED") {
    throw badRequest(
      "Cannot reply to a comment that has not been published to the platform yet",
    );
  }

  // Use denormalized depth — no parent-walk queries.
  if (parent.depth >= adapter.maxReplyDepth) {
    throw badRequest(
      `${post.platform} only allows replies up to depth ${adapter.maxReplyDepth} (cannot reply to nested comments)`,
    );
  }

  const depth = parent.depth + 1;
  const rootCommentId = parent.rootCommentId ?? parent.id;

  const pending = await prisma.comment.create({
    data: {
      postId: post.id,
      parentCommentId: parent.id,
      rootCommentId,
      depth,
      authorHandle: post.socialAccount.displayName,
      authorExternalId: post.socialAccount.externalAccountId,
      body,
      isOurs: true,
      status: "PENDING_PUBLISH",
    },
  });

  const synced = await publishReplyToPlatform({ post, pending, parent });
  const canReply = synced.depth < adapter.maxReplyDepth;
  const node = toNode(synced, canReply);

  if (params.idempotencyKey) {
    await storeIdempotentResponse(scope, params.idempotencyKey, node);
  }
  return node;
}

/** Retry a FAILED reply via the outbox. */
export async function retryFailedReply(params: {
  postId: string;
  commentId: string;
}): Promise<CommentNode> {
  const post = await loadPostOrThrow(params.postId);
  const adapter = getAdapter(post.platform);

  const pending = await prisma.comment.findFirst({
    where: {
      id: params.commentId,
      postId: post.id,
      isOurs: true,
      status: "FAILED",
    },
  });
  if (!pending) {
    throw notFound(`Failed reply not found: ${params.commentId}`);
  }
  if (!pending.parentCommentId) {
    throw badRequest("Failed comment has no parent to reply to");
  }

  const parent = await prisma.comment.findFirstOrThrow({
    where: { id: pending.parentCommentId, postId: post.id },
  });

  await prisma.comment.update({
    where: { id: pending.id },
    data: { status: "PENDING_PUBLISH", failReason: null },
  });

  const refreshedPending = await prisma.comment.findUniqueOrThrow({
    where: { id: pending.id },
  });

  const synced = await publishReplyToPlatform({
    post,
    pending: refreshedPending,
    parent,
  });
  const canReply = synced.depth < adapter.maxReplyDepth;
  return toNode(synced, canReply);
}
