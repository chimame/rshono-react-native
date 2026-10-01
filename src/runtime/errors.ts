/** Fetch and configuration errors detected by the library. Message strings are not a compatibility contract. */
export type RshonoErrorCode =
  | "CONFIGURATION_ERROR"
  | "INVALID_URL"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "DECODE_ERROR"
  | "TIMEOUT"
  | "REDIRECT"
  | "NOT_FOUND"
  | "ACTION_ERROR";
export class RshonoError extends Error {
  readonly code: RshonoErrorCode;
  readonly status?: number;
  readonly location?: string;
  readonly requestId?: string;
  constructor(
    code: RshonoErrorCode,
    message: string,
    options: { cause?: unknown; status?: number; location?: string; requestId?: string } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "RshonoError";
    this.code = code;
    this.status = options.status;
    this.location = options.location;
    this.requestId = options.requestId;
  }
}
export function httpUrl(address: string): URL {
  let url: URL;
  try {
    url = new URL(address);
  } catch (cause) {
    throw new RshonoError("INVALID_URL", "Specify a valid HTTP(S) URL.", {
      cause,
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new RshonoError("INVALID_URL", "The URL must use HTTP or HTTPS.");
  return url;
}

/** Recognize the pinned RSHono control protocol, including late Suspense failures. */
export function controlError(cause: unknown): RshonoError | null {
  if (cause instanceof RshonoError && (cause.code === "REDIRECT" || cause.code === "NOT_FOUND"))
    return cause;
  const digest = (cause as { digest?: unknown } | null)?.digest;
  if (digest === "RSHONO_NOT_FOUND")
    return new RshonoError("NOT_FOUND", "The server page was not found.", { status: 404, cause });
  if (typeof digest !== "string" || !digest.startsWith("RSHONO_REDIRECT;")) return null;
  const match = /^RSHONO_REDIRECT;(301|302|303|307|308);(.+)$/.exec(digest);
  if (!match) return null;
  try {
    return new RshonoError("REDIRECT", "The server requested navigation.", {
      status: Number(match[1]),
      location: decodeURIComponent(match[2]),
      cause,
    });
  } catch {
    return null;
  }
}
