import type { Platform, SocialAccount } from "@prisma/client";

/** Normalized comment shape returned by platform adapters / mock APIs. */
export interface ExternalComment {
  externalCommentId: string;
  parentExternalCommentId: string | null;
  authorHandle: string;
  authorExternalId: string | null;
  body: string;
  createdAt: Date;
  /** Opaque platform fields we store but do not interpret in the core model. */
  platformRaw?: Record<string, unknown>;
}

/** Richer result from publishing a reply on a platform. */
export interface PlatformReplyResult {
  externalCommentId: string;
  platform: Platform;
  createdAt: Date;
  parentExternalCommentId: string;
  authorHandle: string;
  authorExternalId: string | null;
  body: string;
}

export interface ListCommentsContext {
  externalPostId: string;
  account: SocialAccount;
}

export interface ReplyToCommentContext {
  externalPostId: string;
  externalCommentId: string;
  body: string;
  account: SocialAccount;
}

/**
 * Each social network implements this contract.
 * Adapters own platform rules; mock clients own the "HTTP" call;
 * repositories own persistence of remote/stub data.
 *
 * `maxReplyDepth` — deepest reply allowed under a post:
 * - depth 0 = top-level comment
 * - depth 1 = reply to a top-level comment
 * A reply is allowed only when `parentDepth < maxReplyDepth`.
 */
export interface SocialPlatformAdapter {
  readonly platform: Platform;
  readonly maxReplyDepth: number;
  listComments(ctx: ListCommentsContext): Promise<ExternalComment[]>;
  replyToComment(ctx: ReplyToCommentContext): Promise<PlatformReplyResult>;
}
