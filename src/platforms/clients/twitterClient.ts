import { randomUUID } from "node:crypto";
import type { PlatformCommentRepository } from "../repository/inMemoryPlatformCommentStore.js";
import type { ExternalComment } from "../types.js";
import {
  PlatformApiError,
  PlatformCommentNotFoundError,
} from "../errors.js";

export interface CreateReplyInput {
  externalPostId: string;
  parentExternalCommentId: string;
  body: string;
  authorHandle: string;
  authorExternalId: string;
}

/**
 * Mock Twitter/X HTTP client.
 * In production this would call X API v2 (conversation + create tweet).
 * Persistence goes through the repository — this class does not own storage.
 */
export class TwitterApiClient {
  constructor(private readonly repository: PlatformCommentRepository) {}

  /** Simulates GET conversation / mention timeline for a post. */
  async listComments(externalPostId: string): Promise<ExternalComment[]> {
    try {
      return await this.repository.listByPost(externalPostId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      throw new PlatformApiError("TWITTER", message);
    }
  }

  async getComment(
    externalPostId: string,
    externalCommentId: string,
  ): Promise<ExternalComment | null> {
    try {
      return await this.repository.findByExternalId(
        externalPostId,
        externalCommentId,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      throw new PlatformApiError("TWITTER", message);
    }
  }

  /**
   * Simulates POST /2/tweets (in_reply_to_tweet_id).
   * // In production: await fetch("https://api.x.com/2/tweets", ...)
   */
  async createReply(input: CreateReplyInput): Promise<ExternalComment> {
    const parent = await this.repository.findByExternalId(
      input.externalPostId,
      input.parentExternalCommentId,
    );
    if (!parent) {
      throw new PlatformCommentNotFoundError(
        "TWITTER",
        input.parentExternalCommentId,
      );
    }

    const reply: ExternalComment = {
      externalCommentId: `tw_cmt_${randomUUID().slice(0, 8)}`,
      parentExternalCommentId: input.parentExternalCommentId,
      authorHandle: input.authorHandle,
      authorExternalId: input.authorExternalId,
      body: input.body,
      createdAt: new Date(),
      platformRaw: { source: "api_reply" },
    };

    try {
      return await this.repository.create(input.externalPostId, reply);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      throw new PlatformApiError("TWITTER", message);
    }
  }
}
