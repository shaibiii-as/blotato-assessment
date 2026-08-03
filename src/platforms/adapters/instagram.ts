import type { ExternalComment, SocialPlatformAdapter } from "../types.js";
import { createInMemoryPlatformCommentRepository } from "../repository/inMemoryPlatformCommentStore.js";
import { InstagramApiClient } from "../clients/instagramClient.js";
import {
  PlatformCommentNotFoundError,
  PlatformValidationError,
} from "../errors.js";

function seedInstagram(externalPostId: string): ExternalComment[] {
  const rootId = `ig_cmt_${externalPostId}_1`;
  return [
    {
      externalCommentId: rootId,
      parentExternalCommentId: null,
      authorHandle: "dana.creates",
      authorExternalId: "ig_user_dana",
      body: "This reel is fire 🔥",
      createdAt: new Date("2024-06-02T09:00:00Z"),
      platformRaw: { mediaType: "REEL" },
    },
    {
      externalCommentId: `ig_cmt_${externalPostId}_2`,
      parentExternalCommentId: rootId,
      authorHandle: "evan.edits",
      authorExternalId: "ig_user_evan",
      body: "Which preset did you use?",
      createdAt: new Date("2024-06-02T09:30:00Z"),
    },
  ];
}

const repository = createInMemoryPlatformCommentRepository(seedInstagram);
const instagramApi = new InstagramApiClient(repository);

/**
 * Instagram adapter: platform rules only (one-level replies).
 * Remote I/O → InstagramApiClient; persistence → repository.
 */
export const instagramAdapter: SocialPlatformAdapter = {
  platform: "INSTAGRAM",
  maxReplyDepth: 1,

  async listComments({ externalPostId }) {
    return instagramApi.listComments(externalPostId);
  },

  async replyToComment({ externalPostId, externalCommentId, body, account }) {
    const parent = await instagramApi.getComment(
      externalPostId,
      externalCommentId,
    );
    if (!parent) {
      throw new PlatformCommentNotFoundError("INSTAGRAM", externalCommentId);
    }
    if (parent.parentExternalCommentId !== null) {
      throw new PlatformValidationError(
        "INSTAGRAM",
        "Instagram does not support nested replies beyond one level",
      );
    }

    // Production: Graph API POST /{comment-id}/replies
    const created = await instagramApi.createReply({
      externalPostId,
      parentExternalCommentId: externalCommentId,
      body,
      authorHandle: account.displayName,
      authorExternalId: account.externalAccountId,
    });

    return {
      externalCommentId: created.externalCommentId,
      platform: "INSTAGRAM",
      createdAt: created.createdAt,
      parentExternalCommentId: externalCommentId,
      authorHandle: created.authorHandle,
      authorExternalId: created.authorExternalId,
      body: created.body,
    };
  },
};
