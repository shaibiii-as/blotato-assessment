-- Schema v2: workspace tenancy, denormalized depth/root, outbox, scoped idempotency.
-- Existing demo rows cannot satisfy new NOT NULL columns, so we clear and rebuild.
-- Re-run `npm run seed` after applying.

PRAGMA foreign_keys=OFF;

-- Clear dependent data first
DELETE FROM "Comment";
DELETE FROM "Post";
DELETE FROM "SocialAccount";
DELETE FROM "IdempotencyKey";

DROP TABLE IF EXISTS "PublishOutbox";
DROP TABLE IF EXISTS "Comment";
DROP TABLE IF EXISTS "Post";
DROP TABLE IF EXISTS "SocialAccount";
DROP TABLE IF EXISTS "IdempotencyKey";
DROP TABLE IF EXISTS "Workspace";

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SocialAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "socialAccountId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalPostId" TEXT NOT NULL,
    "caption" TEXT,
    "publishedAt" DATETIME NOT NULL,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Post_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "parentCommentId" TEXT,
    "rootCommentId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "externalCommentId" TEXT,
    "authorHandle" TEXT NOT NULL,
    "authorExternalId" TEXT,
    "body" TEXT NOT NULL,
    "isOurs" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'SYNCED',
    "failReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "platformRaw" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "Comment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Comment_rootCommentId_fkey" FOREIGN KEY ("rootCommentId") REFERENCES "Comment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublishOutbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PublishOutbox_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublishOutbox_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX "SocialAccount_workspaceId_idx" ON "SocialAccount"("workspaceId");
CREATE UNIQUE INDEX "SocialAccount_workspaceId_platform_externalAccountId_key" ON "SocialAccount"("workspaceId", "platform", "externalAccountId");

CREATE INDEX "Post_socialAccountId_idx" ON "Post"("socialAccountId");
CREATE INDEX "Post_lastSyncedAt_idx" ON "Post"("lastSyncedAt");
CREATE UNIQUE INDEX "Post_platform_externalPostId_key" ON "Post"("platform", "externalPostId");

CREATE INDEX "Comment_postId_createdAt_id_idx" ON "Comment"("postId", "createdAt", "id");
CREATE INDEX "Comment_parentCommentId_idx" ON "Comment"("parentCommentId");
CREATE INDEX "Comment_rootCommentId_idx" ON "Comment"("rootCommentId");
CREATE INDEX "Comment_postId_depth_idx" ON "Comment"("postId", "depth");
CREATE INDEX "Comment_status_idx" ON "Comment"("status");
-- Partial unique: multiple NULLs allowed for pending publishes
CREATE UNIQUE INDEX "Comment_postId_externalCommentId_active_key"
  ON "Comment"("postId", "externalCommentId")
  WHERE "externalCommentId" IS NOT NULL;

CREATE UNIQUE INDEX "PublishOutbox_commentId_key" ON "PublishOutbox"("commentId");
CREATE INDEX "PublishOutbox_status_availableAt_idx" ON "PublishOutbox"("status", "availableAt");

CREATE UNIQUE INDEX "IdempotencyKey_scope_key_key" ON "IdempotencyKey"("scope", "key");
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

PRAGMA foreign_keys=ON;
