import type { ExternalComment, SocialPlatformAdapter } from "../types.js";
import { createInMemoryPlatformCommentRepository } from "../repository/inMemoryPlatformCommentStore.js";
import { TwitterApiClient } from "../clients/twitterClient.js";
import {
  PlatformCommentNotFoundError,
  PlatformValidationError,
} from "../errors.js";

function seedTwitter(externalPostId: string): ExternalComment[] {
  const rootId = `tw_cmt_${externalPostId}_1`;
  return [
    {
      externalCommentId: rootId,
      parentExternalCommentId: null,
      authorHandle: "@alice",
      authorExternalId: "tw_user_alice",
      body: "Love this announcement!",
      createdAt: new Date("2024-06-01T10:00:00Z"),
      platformRaw: { likeCount: 12 },
    },
    {
      externalCommentId: `tw_cmt_${externalPostId}_2`,
      parentExternalCommentId: rootId,
      authorHandle: "@bob",
      authorExternalId: "tw_user_bob",
      body: "Same here — when does it launch?",
      createdAt: new Date("2024-06-01T10:15:00Z"),
      platformRaw: { likeCount: 3 },
    },
    {
      externalCommentId: `tw_cmt_${externalPostId}_3`,
      parentExternalCommentId: null,
      authorHandle: "@carol",
      authorExternalId: "tw_user_carol",
      body: "Curious about pricing.",
      createdAt: new Date("2024-06-01T11:00:00Z"),
    },
  ];
}

const repository = createInMemoryPlatformCommentRepository(seedTwitter);
const twitterApi = new TwitterApiClient(repository);

/**
 * Twitter adapter: platform rules only.
 * Remote I/O → TwitterApiClient; persistence → repository.
 */
export const twitterAdapter: SocialPlatformAdapter = {
  platform: "TWITTER",
  maxReplyDepth: 1,

  async listComments({ externalPostId }) {
    return twitterApi.listComments(externalPostId);
  },

  async replyToComment({ externalPostId, externalCommentId, body, account }) {
    const parent = await twitterApi.getComment(externalPostId, externalCommentId);
    if (!parent) {
      throw new PlatformCommentNotFoundError("TWITTER", externalCommentId);
    }
    if (parent.parentExternalCommentId !== null) {
      throw new PlatformValidationError(
        "TWITTER",
        "Replies to nested comments are not supported (max depth is 1)",
      );
    }

    // Production: await twitterApi.createReply(...) hits X HTTP API.
    const created = await twitterApi.createReply({
      externalPostId,
      parentExternalCommentId: externalCommentId,
      body,
      authorHandle: account.displayName,
      authorExternalId: account.externalAccountId,
    });

    return {
      externalCommentId: created.externalCommentId,
      platform: "TWITTER",
      createdAt: created.createdAt,
      parentExternalCommentId: externalCommentId,
      authorHandle: created.authorHandle,
      authorExternalId: created.authorExternalId,
      body: created.body,
    };
  },
};
