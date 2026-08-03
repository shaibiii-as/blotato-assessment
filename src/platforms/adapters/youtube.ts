import type { ExternalComment, SocialPlatformAdapter } from "../types.js";
import { createInMemoryPlatformCommentRepository } from "../repository/inMemoryPlatformCommentStore.js";
import { YouTubeApiClient } from "../clients/youtubeClient.js";
import {
  PlatformCommentNotFoundError,
  PlatformValidationError,
} from "../errors.js";

function seedYouTube(externalPostId: string): ExternalComment[] {
  const rootId = `yt_cmt_${externalPostId}_1`;
  return [
    {
      externalCommentId: rootId,
      parentExternalCommentId: null,
      authorHandle: "FranFan",
      authorExternalId: "yt_channel_fran",
      body: "Great tutorial — timestamp for the advanced section?",
      createdAt: new Date("2024-06-03T14:00:00Z"),
      platformRaw: { likeCount: 42, totalReplyCount: 1 },
    },
    {
      externalCommentId: `yt_cmt_${externalPostId}_2`,
      parentExternalCommentId: rootId,
      authorHandle: "FranFan",
      authorExternalId: "yt_channel_fran",
      body: "Never mind, found it at 12:40.",
      createdAt: new Date("2024-06-03T14:20:00Z"),
    },
    {
      externalCommentId: `yt_cmt_${externalPostId}_3`,
      parentExternalCommentId: null,
      authorHandle: "GabeCodes",
      authorExternalId: "yt_channel_gabe",
      body: "Could you cover Pinocchio next?",
      createdAt: new Date("2024-06-03T15:00:00Z"),
    },
  ];
}

const repository = createInMemoryPlatformCommentRepository(seedYouTube);
const youtubeApi = new YouTubeApiClient(repository);

/**
 * YouTube adapter: platform rules only (replies attach to top-level threads).
 * Remote I/O → YouTubeApiClient; persistence → repository.
 */
export const youtubeAdapter: SocialPlatformAdapter = {
  platform: "YOUTUBE",
  maxReplyDepth: 1,

  async listComments({ externalPostId }) {
    return youtubeApi.listComments(externalPostId);
  },

  async replyToComment({ externalPostId, externalCommentId, body, account }) {
    const parent = await youtubeApi.getComment(
      externalPostId,
      externalCommentId,
    );
    if (!parent) {
      throw new PlatformCommentNotFoundError("YOUTUBE", externalCommentId);
    }
    if (parent.parentExternalCommentId !== null) {
      throw new PlatformValidationError(
        "YOUTUBE",
        "YouTube does not support nested replies beyond one level",
      );
    }

    // Production: youtube.comments.insert({ parentId })
    const created = await youtubeApi.createReply({
      externalPostId,
      parentExternalCommentId: externalCommentId,
      body,
      authorHandle: account.displayName,
      authorExternalId: account.externalAccountId,
    });

    return {
      externalCommentId: created.externalCommentId,
      platform: "YOUTUBE",
      createdAt: created.createdAt,
      parentExternalCommentId: externalCommentId,
      authorHandle: created.authorHandle,
      authorExternalId: created.authorExternalId,
      body: created.body,
    };
  },
};
