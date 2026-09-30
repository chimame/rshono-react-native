/** Fetch and configuration errors detected by the library. Message strings are not a compatibility contract. */
export type RshonoErrorCode =
  | "CONFIGURATION_ERROR"
  | "INVALID_URL"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "BUILD_MISMATCH"
  | "DECODE_ERROR"
  | "TIMEOUT";
export class RshonoError extends Error {
  readonly code: RshonoErrorCode;
  readonly status?: number;
  constructor(
    code: RshonoErrorCode,
    message: string,
    options: { cause?: unknown; status?: number } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "RshonoError";
    this.code = code;
    this.status = options.status;
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
