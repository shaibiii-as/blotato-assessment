import type { Platform } from "@prisma/client";
import type { SocialPlatformAdapter } from "./types.js";
import { twitterAdapter } from "./adapters/twitter.js";
import { instagramAdapter } from "./adapters/instagram.js";
import { youtubeAdapter } from "./adapters/youtube.js";

const adapters: Record<Platform, SocialPlatformAdapter> = {
  TWITTER: twitterAdapter,
  INSTAGRAM: instagramAdapter,
  YOUTUBE: youtubeAdapter,
};

export function getAdapter(platform: Platform): SocialPlatformAdapter {
  const adapter = adapters[platform];
  if (!adapter) {
    throw new Error(`No adapter registered for platform: ${platform}`);
  }
  return adapter;
}

export function listRegisteredPlatforms(): Platform[] {
  return Object.keys(adapters) as Platform[];
}
