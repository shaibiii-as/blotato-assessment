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
 * Mock YouTube Data API client.
 * In production: commentThreads.list / comments.insert.
 */
export class YouTubeApiClient {
  constructor(private readonly repository: PlatformCommentRepository) {}

  async listComments(externalPostId: string): Promise<ExternalComment[]> {
    try {
      return await this.repository.listByPost(externalPostId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      throw new PlatformApiError("YOUTUBE", message);
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
      throw new PlatformApiError("YOUTUBE", message);
    }
  }

  /**
   * Simulates comments.insert (parentId = top-level comment).
   * // In production: await youtube.comments.insert(...)
   */
  async createReply(input: CreateReplyInput): Promise<ExternalComment> {
    const parent = await this.repository.findByExternalId(
      input.externalPostId,
      input.parentExternalCommentId,
    );
    if (!parent) {
      throw new PlatformCommentNotFoundError(
        "YOUTUBE",
        input.parentExternalCommentId,
      );
    }

    const reply: ExternalComment = {
      externalCommentId: `yt_cmt_${randomUUID().slice(0, 8)}`,
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
      throw new PlatformApiError("YOUTUBE", message);
    }
  }
}
