import { RshonoError, httpUrl, controlError } from "./errors";
import { abortable, abortReason, monitorStream } from "./stream";
import { FlightCache } from "./cache";
import type { ReactNode } from "react";

export type CallServer = (id: string, args: unknown[]) => Promise<unknown>;
export type FlightPayload = {
  root: ReactNode;
  redirect?: string;
  notFound?: boolean;
  returnValue?: { ok: true; value: unknown } | { ok: false; error: unknown };
};
export type DecodeOptions = { callServer?: CallServer; temporaryReferences?: unknown };
export type NativeManifest = {
  createFromReadableStream(
    stream: ReadableStream<Uint8Array>,
    options?: DecodeOptions,
  ): PromiseLike<FlightPayload>;
  encodeReply?(
    args: unknown[],
    options?: { temporaryReferences?: unknown; signal?: AbortSignal },
  ): Promise<string | FormData>;
  createTemporaryReferenceSet?(): unknown;
  getServerFunctionId?(reference: unknown): Promise<string>;
};
export type FlightResponse = {
  ok: boolean;
  status: number;
  url?: string;
  redirected?: boolean;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
};
export type FlightFetch = (
  url: string,
  init: {
    headers: Record<string, string>;
    signal: AbortSignal;
    method?: "POST";
    body?: string | FormData;
    redirect?: "manual";
  },
) => Promise<FlightResponse>;
export type LoadOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  streamIdleTimeoutMs?: number;
  timeoutMs?: number;
  cache?: boolean;
  onPayload?: (payload: FlightPayload) => void;
  onControl?: (error: RshonoError) => void;
  actionSignal?: AbortSignal;
  scheduleAction?: (run: () => Promise<unknown>) => Promise<unknown>;
};
export type NativeClient = {
  load(url: string, options?: LoadOptions): Promise<FlightPayload>;
  callServer?(
    url: string,
    id: string,
    args: unknown[],
    options?: LoadOptions,
  ): Promise<FlightPayload>;
  serverFunctionId?(reference: unknown): Promise<string>;
  prefetch?(url: string, options?: LoadOptions): Promise<void>;
  invalidate?(): void;
};
export type RequestEvent = {
  type: "request" | "response" | "error";
  requestId: string;
  url: string;
  method: "GET" | "POST";
  status?: number;
  durationMs?: number;
  error?: unknown;
  serverRequestId?: string;
};
export type NativeClientOptions = {
  manifest: NativeManifest;
  fetch: FlightFetch;
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Called once for concurrent 401s. Only GET requests are retried automatically. */
  onUnauthorized?: () => void | Promise<void>;
  onRequest?: (event: RequestEvent) => void;
  onError?: (error: unknown, event: RequestEvent) => void;
  cacheTimeMs?: number;
  staleIfErrorMs?: number;
  maxCacheEntries?: number;
  maxCacheBytes?: number;
};
export function mergeHeaders(
  ...sources: (Record<string, string> | undefined)[]
): Record<string, string> {
  const headers = new Map<string, [string, string]>();
  for (const source of sources)
    for (const [name, value] of Object.entries(source ?? {}))
      headers.set(name.toLowerCase(), [name, value]);
  return Object.fromEntries(headers.values());
}
function positive(value: number | undefined, name: string, allowZero = true) {
  if (value !== undefined && (!Number.isFinite(value) || value < (allowZero ? 0 : 1)))
    throw new RshonoError(
      "CONFIGURATION_ERROR",
      `${name} must be a finite ${allowZero ? "non-negative" : "positive"} number.`,
    );
}
let nextRequest = 0;
export function createNativeClient({
  manifest,
  fetch: fetcher,
  getHeaders,
  onUnauthorized,
  onRequest,
  onError,
  cacheTimeMs = 0,
  staleIfErrorMs = 0,
  maxCacheEntries = 32,
  maxCacheBytes = 1024 * 1024,
}: NativeClientOptions): NativeClient {
  positive(cacheTimeMs, "cacheTimeMs");
  positive(staleIfErrorMs, "staleIfErrorMs");
  positive(maxCacheEntries, "maxCacheEntries", false);
  positive(maxCacheBytes, "maxCacheBytes", false);
  if (
    !manifest ||
    typeof manifest.createFromReadableStream !== "function" ||
    typeof fetcher !== "function"
  )
    throw new RshonoError(
      "CONFIGURATION_ERROR",
      "Provide a Flight decoder and streaming fetch implementation.",
    );
  const cache = new FlightCache(
    cacheTimeMs,
    Math.floor(maxCacheEntries),
    maxCacheBytes,
    staleIfErrorMs,
  );
  let refreshing: Promise<void> | undefined;
  let authRevision = 0;
  const emit = (event: RequestEvent) => {
    try {
      onRequest?.(event);
      if (event.type === "error") onError?.(event.error, event);
    } catch {
      /* Reporting cannot fail requests. */
    }
  };
  async function request(
    address: string,
    options: LoadOptions,
    action?: { id: string; args: unknown[] },
  ): Promise<FlightPayload> {
    const url = httpUrl(address);
    if (url.username || url.password)
      throw new RshonoError("INVALID_URL", "Request URLs must not contain credentials.");
    positive(options.timeoutMs, "timeoutMs");
    positive(options.streamIdleTimeoutMs, "streamIdleTimeoutMs");
    const parent = options.signal;
    const controller = options.timeoutMs ? new AbortController() : undefined;
    const signal = controller?.signal ?? parent ?? new AbortController().signal;
    const forward = () => controller?.abort(parent ? abortReason(parent) : undefined);
    parent?.addEventListener?.("abort", forward, { once: true });
    if (parent?.aborted) forward();
    const timer = controller
      ? setTimeout(
          () => controller.abort(new RshonoError("TIMEOUT", "Fetching the RSC payload timed out.")),
          options.timeoutMs,
        )
      : undefined;
    const requestId = `native-${++nextRequest}`;
    const event: RequestEvent = {
      type: "request",
      requestId,
      url: url.origin + url.pathname,
      method: action ? "POST" : "GET",
    };
    const started = Date.now();
    let keepForward = false;
    try {
      if (signal.aborted) throw abortReason(signal);
      let headers = mergeHeaders(
        await abortable(Promise.resolve(getHeaders?.()), signal),
        options.headers,
      );
      const authAtStart = authRevision;
      for (const name of Object.keys(headers))
        if (["rsc", "x-rsc-action"].includes(name.toLowerCase())) delete headers[name];
      headers.RSC = "1";
      let body: string | FormData | undefined;
      const temporaryReferences = action ? manifest.createTemporaryReferenceSet?.() : undefined;
      if (action) {
        if (!manifest.encodeReply)
          throw new RshonoError(
            "CONFIGURATION_ERROR",
            "Rebuild the generated client to enable Server Functions.",
          );
        if (!action.id)
          throw new RshonoError("ACTION_ERROR", "Specify a Server Function reference ID.");
        headers["x-rsc-action"] = action.id;
        body = await abortable(
          manifest.encodeReply(action.args, { temporaryReferences, signal }),
          signal,
        );
      }
      emit(event);
      const fetchResponse = async (fetchSignal: AbortSignal) => {
        try {
          let response = await abortable(
            fetcher(url.href, {
              headers,
              signal: fetchSignal,
              ...(action
                ? { method: "POST" as const, body, redirect: "manual" as const }
                : { redirect: "manual" as const }),
            }),
            fetchSignal,
            (response) => {
              void response.body?.cancel().catch(() => {});
            },
          );
          if (response.status === 401 && !action && onUnauthorized) {
            void response.body?.cancel().catch(() => {});
            if (authAtStart === authRevision) {
              refreshing ??= Promise.resolve()
                .then(onUnauthorized)
                .then(() => {
                  authRevision++;
                  cache.clear();
                })
                .finally(() => {
                  refreshing = undefined;
                });
              await abortable(refreshing, fetchSignal);
            }
            const fresh = mergeHeaders(
              await abortable(Promise.resolve(getHeaders?.()), fetchSignal),
              options.headers,
            );
            for (const name of Object.keys(fresh))
              if (["rsc", "x-rsc-action"].includes(name.toLowerCase())) delete fresh[name];
            response = await abortable(
              fetcher(url.href, {
                headers: { ...fresh, RSC: "1" },
                signal: fetchSignal,
                redirect: "manual",
              }),
              fetchSignal,
              (response) => {
                void response.body?.cancel().catch(() => {});
              },
            );
          }
          return response;
        } catch (cause) {
          if (fetchSignal.aborted) throw abortReason(fetchSignal);
          if (cause instanceof RshonoError) throw cause;
          throw new RshonoError("NETWORK_ERROR", "Could not connect to the RSHono server.", {
            cause,
            requestId,
          });
        }
      };
      const key = JSON.stringify([
        url.href,
        Object.entries(headers)
          .map(([k, v]) => [k.toLowerCase(), v])
          .sort(),
        authRevision,
        options.streamIdleTimeoutMs ?? 0,
      ]);
      const response =
        !action && cacheTimeMs > 0 && options.cache !== false
          ? await cache.response(key, signal, (s) => fetchResponse(s))
          : await fetchResponse(signal);
      emit({
        ...event,
        type: "response",
        status: response.status,
        durationMs: Date.now() - started,
        serverRequestId: response.headers.get("x-request-id") ?? undefined,
      });
      if (signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw abortReason(signal);
      }
      if (response.redirected && response.url) {
        let finalUrl: URL;
        try {
          finalUrl = httpUrl(response.url);
        } catch (cause) {
          cache.remove(key);
          void response.body?.cancel().catch(() => {});
          throw new RshonoError(
            "INVALID_RESPONSE",
            "The fetch implementation returned an invalid final URL.",
            { cause, requestId },
          );
        }
        if (finalUrl.origin !== url.origin) {
          cache.remove(key);
          // Cancelling the cache wrapper releases this subscriber; the last one stops the shared reader.
          void response.body?.cancel().catch(() => {});
          throw new RshonoError(
            "INVALID_RESPONSE",
            "The fetch implementation followed a cross-origin redirect. Use a fetch implementation supporting redirect: manual.",
          );
        }
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        void response.body?.cancel().catch(() => {});
        const location = response.headers.get("location");
        if (!location)
          throw new RshonoError("INVALID_RESPONSE", "A redirect response is missing Location.");
        try {
          const target = new URL(location, url);
          if (!["http:", "https:"].includes(target.protocol) || target.username || target.password)
            throw new Error("Invalid redirect");
        } catch (cause) {
          throw new RshonoError(
            "INVALID_RESPONSE",
            "The server returned an invalid redirect location.",
            { cause, requestId },
          );
        }
        throw new RshonoError("REDIRECT", "The server requested navigation.", {
          status: response.status,
          location,
          requestId,
        });
      }
      const flight =
        response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ===
        "text/x-component";
      if (
        !response.ok &&
        !(flight && (response.status === 404 || (action && response.status === 500)))
      ) {
        void response.body?.cancel().catch(() => {});
        throw new RshonoError(
          response.status === 404 ? "NOT_FOUND" : "HTTP_ERROR",
          `The RSHono server returned HTTP ${response.status}.`,
          { status: response.status, requestId },
        );
      }
      if (!flight || !response.body) {
        void response.body?.cancel().catch(() => {});
        throw new RshonoError(
          "INVALID_RESPONSE",
          !flight ? "The response is not an RSC payload." : "The RSC payload body is missing.",
        );
      }
      // The monitor owns cancellation after the root resolves; the parent remains connected until EOF.
      let cancelStream: (reason: unknown) => void = () => {};
      let rootDecoded = false;
      const stream = monitorStream(
        response.body,
        signal,
        options.streamIdleTimeoutMs,
        () => parent?.removeEventListener?.("abort", forward),
        (error) => {
          if (rootDecoded && !(error instanceof Error && error.name === "AbortError"))
            emit({ ...event, type: "error", error, durationMs: Date.now() - started });
        },
        (cancel) => {
          cancelStream = cancel;
        },
      );
      keepForward = true;
      let payload: FlightPayload;
      try {
        payload = await abortable(
          manifest.createFromReadableStream(stream, {
            temporaryReferences,
            callServer: (id, args) => {
              const run = async () => {
                let updated: FlightPayload;
                try {
                  updated = await request(
                    url.href,
                    {
                      ...options,
                      signal: options.actionSignal,
                      cache: false,
                      timeoutMs: options.timeoutMs ?? 15000,
                    },
                    { id, args },
                  );
                } catch (cause) {
                  const control = controlError(cause);
                  if (control) options.onControl?.(control);
                  throw cause;
                }
                cache.clear();
                options.onPayload?.(updated);
                if (updated.redirect || updated.notFound) return undefined;
                if (!updated.returnValue)
                  throw new RshonoError("ACTION_ERROR", "The server action produced no result.");
                if (!updated.returnValue.ok) throw updated.returnValue.error;
                return updated.returnValue.value;
              };
              return options.scheduleAction ? options.scheduleAction(run) : run();
            },
          }),
          signal,
        );
      } catch (cause) {
        cache.remove(key);
        cancelStream(cause);
        if (signal.aborted) throw abortReason(signal);
        const control = controlError(cause);
        if (control) throw control;
        throw new RshonoError("DECODE_ERROR", "Could not decode the RSC payload.", {
          cause,
          requestId,
        });
      }
      if (!payload || !Object.prototype.hasOwnProperty.call(payload, "root")) {
        const error = new RshonoError("INVALID_RESPONSE", "The RSC payload is missing root.");
        cache.remove(key);
        cancelStream(error);
        throw error;
      }
      rootDecoded = true;
      if (action) cache.clear();
      return payload;
    } catch (error) {
      emit({ ...event, type: "error", error, durationMs: Date.now() - started });
      throw error;
    } finally {
      clearTimeout(timer);
      if (!keepForward) parent?.removeEventListener?.("abort", forward);
    }
  }
  const client: NativeClient = {
    load: (url, options = {}) => request(url, options),
    callServer: (url, id, args, options = {}) => request(url, options, { id, args }),
    serverFunctionId: async (reference) => {
      if (!manifest.getServerFunctionId)
        throw new RshonoError(
          "CONFIGURATION_ERROR",
          "Rebuild the generated client to import Server Functions.",
        );
      return manifest.getServerFunctionId(reference);
    },
    prefetch: async (url, options = {}) => {
      if (cacheTimeMs <= 0)
        throw new RshonoError("CONFIGURATION_ERROR", "Set cacheTimeMs to enable prefetch.");
      await request(url, options);
    },
    invalidate: () => cache.clear(),
  };
  return client;
}
