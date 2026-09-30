import { RshonoError, httpUrl } from "./errors";
import type { ReactNode } from "react";

export type FlightPayload = { root: ReactNode };
export type NativeManifest = {
  buildId: string;
  createFromReadableStream(stream: ReadableStream<Uint8Array>): PromiseLike<FlightPayload>;
};
export type FlightResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
};
export type FlightFetch = (
  url: string,
  init: {
    headers: Record<string, string>;
    signal: AbortSignal;
  },
) => Promise<FlightResponse>;
export type LoadOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
};
export type NativeClient = {
  load(url: string, options?: LoadOptions): Promise<FlightPayload>;
};

// Use basic AbortSignal properties because React Native does not provide throwIfAborted.
function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) return;
  const error = new Error("The connection was aborted.");
  error.name = "AbortError";
  throw signal.reason ?? error;
}

export function createNativeClient({
  manifest,
  fetch: fetcher,
}: {
  manifest: NativeManifest;
  fetch: FlightFetch;
}): NativeClient {
  if (!manifest.buildId)
    throw new RshonoError("CONFIGURATION_ERROR", "The native client is missing a buildId.");
  return {
    async load(address, { signal = new AbortController().signal, headers = {} } = {}) {
      const url = httpUrl(address);
      throwIfAborted(signal);
      // Prevent overriding the RSC header with differently cased header names.
      const requestHeaders = Object.fromEntries(
        Object.entries(headers).filter(([key]) => key.toLowerCase() !== "rsc"),
      );
      let response: FlightResponse;
      try {
        response = await fetcher(url.href, {
          headers: { ...requestHeaders, RSC: "1" },
          signal,
        });
      } catch (cause) {
        throwIfAborted(signal);
        throw new RshonoError("NETWORK_ERROR", "Could not connect to the RSHono server.", {
          cause,
        });
      }
      throwIfAborted(signal);
      if (!response.ok)
        throw new RshonoError("HTTP_ERROR", `The RSHono server returned HTTP ${response.status}.`, {
          status: response.status,
        });
      if (
        response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
        "text/x-component"
      ) {
        throw new RshonoError("INVALID_RESPONSE", "The response is not an RSC payload.");
      }
      if (response.headers.get("x-rshono-native-build") !== manifest.buildId) {
        throw new RshonoError(
          "BUILD_MISMATCH",
          "Server and native builds do not match. Deploy matching builds.",
        );
      }
      if (!response.body)
        throw new RshonoError("INVALID_RESPONSE", "The RSC payload body is missing.");
      let payload: FlightPayload;
      try {
        payload = await manifest.createFromReadableStream(response.body);
      } catch (cause) {
        throwIfAborted(signal);
        throw new RshonoError("DECODE_ERROR", "Could not decode the RSC payload.", { cause });
      }
      throwIfAborted(signal);
      if (!payload || !Object.prototype.hasOwnProperty.call(payload, "root")) {
        throw new RshonoError("INVALID_RESPONSE", "The RSC payload is missing root.");
      }
      return payload;
    },
  };
}
