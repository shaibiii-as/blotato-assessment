import { PrismaClient, Platform } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.publishOutbox.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.post.deleteMany();
  await prisma.socialAccount.deleteMany();
  await prisma.workspace.deleteMany();

  const workspace = await prisma.workspace.create({
    data: { name: "Blotato Demo Workspace" },
  });

  const twitter = await prisma.socialAccount.create({
    data: {
      workspaceId: workspace.id,
      platform: Platform.TWITTER,
      externalAccountId: "tw_user_us",
      displayName: "@blotato_brand",
    },
  });

  const instagram = await prisma.socialAccount.create({
    data: {
      workspaceId: workspace.id,
      platform: Platform.INSTAGRAM,
      externalAccountId: "ig_user_us",
      displayName: "blotato.official",
    },
  });

  const youtube = await prisma.socialAccount.create({
    data: {
      workspaceId: workspace.id,
      platform: Platform.YOUTUBE,
      externalAccountId: "yt_channel_us",
      displayName: "Blotato Channel",
    },
  });

  const twitterPost = await prisma.post.create({
    data: {
      socialAccountId: twitter.id,
      platform: Platform.TWITTER,
      externalPostId: "tw_post_1001",
      caption: "Excited to share our new scheduling features!",
      publishedAt: new Date("2024-06-01T09:00:00Z"),
    },
  });

  const instagramPost = await prisma.post.create({
    data: {
      socialAccountId: instagram.id,
      platform: Platform.INSTAGRAM,
      externalPostId: "ig_media_2002",
      caption: "Behind the scenes of today's shoot",
      publishedAt: new Date("2024-06-02T08:00:00Z"),
    },
  });

  const youtubePost = await prisma.post.create({
    data: {
      socialAccountId: youtube.id,
      platform: Platform.YOUTUBE,
      externalPostId: "yt_video_3003",
      caption: "How we build multi-platform publishing",
      publishedAt: new Date("2024-06-03T12:00:00Z"),
    },
  });

  const root = await prisma.comment.create({
    data: {
      postId: twitterPost.id,
      externalCommentId: "tw_cmt_tw_post_1001_1",
      authorHandle: "@alice",
      authorExternalId: "tw_user_alice",
      body: "Love this announcement!",
      isOurs: false,
      status: "SYNCED",
      depth: 0,
      createdAt: new Date("2024-06-01T10:00:00Z"),
    },
  });

  await prisma.comment.update({
    where: { id: root.id },
    data: { rootCommentId: root.id },
  });

  const child = await prisma.comment.create({
    data: {
      postId: twitterPost.id,
      parentCommentId: root.id,
      rootCommentId: root.id,
      depth: 1,
      externalCommentId: "tw_cmt_tw_post_1001_2",
      authorHandle: "@bob",
      authorExternalId: "tw_user_bob",
      body: "Same here — when does it launch?",
      isOurs: false,
      status: "SYNCED",
      createdAt: new Date("2024-06-01T10:15:00Z"),
    },
  });

  console.log("Seed complete.");
  console.log(`  Workspace: ${workspace.id}`);
  console.log(`  Twitter:   ${twitterPost.id}`);
  console.log(`  Instagram: ${instagramPost.id}`);
  console.log(`  YouTube:   ${youtubePost.id}`);
  console.log(`  Root comment: ${root.id}`);
  console.log(`  Nested comment (no reply UI): ${child.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
