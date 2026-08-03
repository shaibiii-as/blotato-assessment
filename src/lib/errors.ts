export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function notFound(message: string): AppError {
  return new AppError("NOT_FOUND", message, 404);
}

export function badRequest(message: string): AppError {
  return new AppError("BAD_REQUEST", message, 400);
}

export function platformError(message: string): AppError {
  return new AppError("PLATFORM_ERROR", message, 502);
}
