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
 * Mock Instagram Graph API client.
 * In production: GET /{media-id}/comments, POST /{comment-id}/replies.
 */
export class InstagramApiClient {
  constructor(private readonly repository: PlatformCommentRepository) {}

  async listComments(externalPostId: string): Promise<ExternalComment[]> {
    try {
      return await this.repository.listByPost(externalPostId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      throw new PlatformApiError("INSTAGRAM", message);
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
      throw new PlatformApiError("INSTAGRAM", message);
    }
  }

  /**
   * Simulates POST /{comment-id}/replies.
   * // In production: await fetch(`https://graph.facebook.com/v19.0/${id}/replies`, ...)
   */
  async createReply(input: CreateReplyInput): Promise<ExternalComment> {
    const parent = await this.repository.findByExternalId(
      input.externalPostId,
      input.parentExternalCommentId,
    );
    if (!parent) {
      throw new PlatformCommentNotFoundError(
        "INSTAGRAM",
        input.parentExternalCommentId,
      );
    }

    const reply: ExternalComment = {
      externalCommentId: `ig_cmt_${randomUUID().slice(0, 8)}`,
      parentExternalCommentId: input.parentExternalCommentId,
      authorHandle: input.authorHandle,
      authorExternalId: input.authorExternalId,
      body: input.body,
      createdAt: new Date(),
    };

    try {
      return await this.repository.create(input.externalPostId, reply);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      throw new PlatformApiError("INSTAGRAM", message);
    }
  }
}
