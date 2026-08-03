import type { ExternalComment } from "../types.js";

/**
 * Persistence for platform-side (remote) comments.
 * In production this would not exist — the platform is the source of truth.
 * For stubs, the repository isolates storage from adapter / API client logic.
 */
export interface PlatformCommentRepository {
  listByPost(externalPostId: string): Promise<ExternalComment[]>;
  findByExternalId(
    externalPostId: string,
    externalCommentId: string,
  ): Promise<ExternalComment | null>;
  create(
    externalPostId: string,
    comment: ExternalComment,
  ): Promise<ExternalComment>;
}

/**
 * In-memory store keyed by external post ID.
 * `seedFactory` lazily populates a post the first time it is accessed.
 */
export function createInMemoryPlatformCommentRepository(
  seedFactory: (externalPostId: string) => ExternalComment[],
): PlatformCommentRepository {
  const byPost = new Map<string, ExternalComment[]>();

  function ensure(externalPostId: string): ExternalComment[] {
    let comments = byPost.get(externalPostId);
    if (!comments) {
      comments = seedFactory(externalPostId).map((c) => ({ ...c }));
      byPost.set(externalPostId, comments);
    }
    return comments;
  }

  return {
    async listByPost(externalPostId) {
      return ensure(externalPostId).map((c) => ({ ...c }));
    },

    async findByExternalId(externalPostId, externalCommentId) {
      const found = ensure(externalPostId).find(
        (c) => c.externalCommentId === externalCommentId,
      );
      return found ? { ...found } : null;
    },

    async create(externalPostId, comment) {
      const comments = ensure(externalPostId);
      const saved = { ...comment };
      // Immutable update — replace the array rather than mutating via push.
      byPost.set(externalPostId, [...comments, saved]);
      return { ...saved };
    },
  };
}
