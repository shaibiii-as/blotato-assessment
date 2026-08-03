import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const testDb = path.join(root, "prisma", "test.db");

process.env.DATABASE_URL = `file:${testDb}`;

// Fresh file + migrate deploy (no --force-reset; that is blocked in this environment).
for (const f of [testDb, `${testDb}-journal`, `${testDb}-wal`, `${testDb}-shm`]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

execSync("npx prisma migrate deploy", {
  cwd: root,
  env: { ...process.env, DATABASE_URL: `file:${testDb}` },
  stdio: "pipe",
});

const { PrismaClient } = await import("@prisma/client");
const { replyToComment, listComments, retryFailedReply } = await import(
  "../services/commentService.js"
);

const prisma = new PrismaClient();

describe("commentService", () => {
  let postId = "";
  let rootId = "";
  let nestedId = "";

  before(async () => {
    await prisma.$connect();
  });

  after(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.publishOutbox.deleteMany();
    await prisma.idempotencyKey.deleteMany();
    await prisma.comment.deleteMany();
    await prisma.post.deleteMany();
    await prisma.socialAccount.deleteMany();
    await prisma.workspace.deleteMany();

    const workspace = await prisma.workspace.create({
      data: { name: "Test Workspace" },
    });
    const account = await prisma.socialAccount.create({
      data: {
        workspaceId: workspace.id,
        platform: "TWITTER",
        externalAccountId: "tw_user_us",
        displayName: "@blotato_brand",
      },
    });
    const post = await prisma.post.create({
      data: {
        socialAccountId: account.id,
        platform: "TWITTER",
        externalPostId: "tw_post_test",
        caption: "test",
        publishedAt: new Date(),
      },
    });
    const root = await prisma.comment.create({
      data: {
        postId: post.id,
        externalCommentId: "tw_cmt_tw_post_test_1",
        authorHandle: "@alice",
        body: "root",
        status: "SYNCED",
        depth: 0,
      },
    });
    await prisma.comment.update({
      where: { id: root.id },
      data: { rootCommentId: root.id },
    });
    const nested = await prisma.comment.create({
      data: {
        postId: post.id,
        parentCommentId: root.id,
        rootCommentId: root.id,
        depth: 1,
        externalCommentId: "tw_cmt_tw_post_test_2",
        authorHandle: "@bob",
        body: "nested",
        status: "SYNCED",
      },
    });

    postId = post.id;
    rootId = root.id;
    nestedId = nested.id;
  });

  it("rejects replies to nested comments using denormalized depth", async () => {
    await assert.rejects(
      () =>
        replyToComment({
          postId,
          commentId: nestedId,
          body: "should fail",
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /depth 1|nested/i);
        return true;
      },
    );
  });

  it("publishes a reply to a top-level comment and sets depth/root", async () => {
    const node = await replyToComment({
      postId,
      commentId: rootId,
      body: "thanks!",
    });

    assert.equal(node.depth, 1);
    assert.equal(node.rootCommentId, rootId);
    assert.equal(node.parentCommentId, rootId);
    assert.equal(node.status, "SYNCED");
    assert.ok(node.externalCommentId);
    assert.equal(node.canReply, false);
  });

  it("is idempotent for the same Idempotency-Key", async () => {
    const key = "test-key-1";
    const first = await replyToComment({
      postId,
      commentId: rootId,
      body: "once",
      idempotencyKey: key,
    });
    const second = await replyToComment({
      postId,
      commentId: rootId,
      body: "once",
      idempotencyKey: key,
    });

    assert.equal(first.id, second.id);
    const count = await prisma.comment.count({
      where: { postId, body: "once", isOurs: true },
    });
    assert.equal(count, 1);
  });

  it("sync updates lastSyncedAt", async () => {
    const before = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
    assert.equal(before.lastSyncedAt, null);

    const result = await listComments({ postId, sync: true });
    assert.ok(result.lastSyncedAt);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
    assert.ok(after.lastSyncedAt);
  });

  it("retryFailedReply re-publishes a FAILED comment", async () => {
    const failed = await prisma.comment.create({
      data: {
        postId,
        parentCommentId: rootId,
        rootCommentId: rootId,
        depth: 1,
        authorHandle: "@blotato_brand",
        authorExternalId: "tw_user_us",
        body: "retry me",
        isOurs: true,
        status: "FAILED",
        failReason: "simulated",
        retryCount: 1,
      },
    });
    await prisma.publishOutbox.create({
      data: {
        postId,
        commentId: failed.id,
        status: "FAILED",
        attempts: 1,
        lastError: "simulated",
      },
    });

    const node = await retryFailedReply({ postId, commentId: failed.id });
    assert.equal(node.status, "SYNCED");
    assert.ok(node.externalCommentId);
    assert.equal(node.failReason, null);
  });
});
