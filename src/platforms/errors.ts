import { AppError } from "../lib/errors.js";
import type { Platform } from "@prisma/client";

/** Remote comment ID was not found on the platform (→ 404). */
export class PlatformCommentNotFoundError extends AppError {
  constructor(
    public readonly platform: Platform,
    public readonly externalCommentId: string,
  ) {
    super(
      "PLATFORM_COMMENT_NOT_FOUND",
      `${platform} comment not found: ${externalCommentId}`,
      404,
    );
    this.name = "PlatformCommentNotFoundError";
  }
}

/** Platform rejected the operation as invalid (→ 400). */
export class PlatformValidationError extends AppError {
  constructor(
    public readonly platform: Platform,
    message: string,
  ) {
    super("PLATFORM_VALIDATION_ERROR", message, 400);
    this.name = "PlatformValidationError";
  }
}

/** Upstream platform/API failure (→ 502). */
export class PlatformApiError extends AppError {
  constructor(
    public readonly platform: Platform,
    message: string,
  ) {
    super("PLATFORM_ERROR", `${platform} API error: ${message}`, 502);
    this.name = "PlatformApiError";
  }
}
