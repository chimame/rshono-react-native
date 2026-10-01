import type { FlightResponse } from "./transport";
import { abortable } from "./stream";

type Entry = {
  controller: AbortController;
  response: Promise<FlightResponse>;
  chunks: Uint8Array[];
  subscribers: Map<ReadableStreamDefaultController<Uint8Array>, () => void>;
  users: number;
  bytes: number;
  complete: boolean;
  expires: number;
  error?: unknown;
  cleanup?: () => void;
  passThrough?: boolean;
  ready?: () => void;
};
/** Cache wire bytes, never decoded React trees or screen-bound Server Functions. */
export class FlightCache {
  private entries = new Map<string, Entry>();
  constructor(
    private ttl: number,
    private limit: number,
    private maxBytes: number,
    private staleIfErrorMs = 0,
  ) {}
  remove(key: string) {
    this.entries.delete(key);
  }
  clear() {
    this.entries.clear();
  }
  async response(
    key: string,
    signal: AbortSignal,
    fetch: (signal: AbortSignal) => Promise<FlightResponse>,
  ): Promise<FlightResponse> {
    let entry = this.entries.get(key);
    const stale =
      entry?.complete && entry.expires + this.staleIfErrorMs > Date.now() ? entry : undefined;
    if (entry?.complete && entry.expires <= Date.now()) {
      this.entries.delete(key);
      entry = undefined;
    }
    if (!entry) {
      const controller = new AbortController();
      entry = {
        controller,
        response: null as unknown as Promise<FlightResponse>,
        chunks: [],
        subscribers: new Map(),
        users: 0,
        bytes: 0,
        complete: false,
        expires: 0,
      };
      const current = entry;
      current.response = fetch(controller.signal).then(
        (response) => {
          if (
            (!response.ok && response.status !== 404) ||
            !response.body ||
            response.headers.get("content-type")?.split(";")[0].trim() !== "text/x-component"
          ) {
            current.passThrough = true;
            if (this.entries.get(key) === current) this.entries.delete(key);
            return response;
          }
          const reader = response.body.getReader();
          current.cleanup = () => {
            controller.abort();
            void reader.cancel().catch(() => {});
          };
          void (async () => {
            try {
              while (true) {
                const item = await reader.read();
                if (item.done) break;
                // Only this pump waits here. Every counted user must either register a subscriber
                // (start wakes ready) or release after an abort/error (release wakes ready).
                // Returned bodies transfer that obligation to their owner: cancel on rejection,
                // or consume to EOF. Adding an early exit must preserve one of these wake paths.
                // Wait until all pending readers can receive this chunk before discarding oversized history.
                while (current.subscribers.size < current.users)
                  await new Promise<void>((resolve) => {
                    current.ready = resolve;
                  });
                current.bytes += item.value.byteLength;
                if (current.bytes <= this.maxBytes) current.chunks.push(item.value.slice());
                if (current.bytes > this.maxBytes) {
                  if (this.entries.get(key) === current) this.entries.delete(key);
                  current.chunks = [];
                }
                for (const subscriber of current.subscribers.keys()) subscriber.enqueue(item.value);
              }
              current.complete = true;
              current.expires = Date.now() + this.ttl;
              if (response.status === 404 && this.entries.get(key) === current)
                this.entries.delete(key);
              if (
                /(?:^|,)\s*no-store(?:\s|,|$)/i.test(response.headers.get("cache-control") ?? "") &&
                this.entries.get(key) === current
              )
                this.entries.delete(key);
              for (const [subscriber, release] of current.subscribers) {
                subscriber.close();
                release();
              }
            } catch (error) {
              current.error = error;
              if (this.entries.get(key) === current) this.entries.delete(key);
              for (const [subscriber, release] of current.subscribers) {
                subscriber.error(error);
                release();
              }
            } finally {
              current.subscribers.clear();
              reader.releaseLock();
            }
          })();
          return response;
        },
        (error) => {
          if (this.entries.get(key) === current) this.entries.delete(key);
          throw error;
        },
      );
      this.entries.set(key, current);
      while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
    }
    const current = entry;
    current.users++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      current.users--;
      current.ready?.();
      current.ready = undefined;
      if (!current.users && !current.complete) {
        if (this.entries.get(key) === current) this.entries.delete(key);
        current.controller.abort();
        current.cleanup?.();
      }
    };
    try {
      const response = await abortable(current.response, signal);
      if (current.passThrough || !response.body) {
        release();
        return response;
      }
      let subscriber: ReadableStreamDefaultController<Uint8Array>;
      const maxBytes = this.maxBytes;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          subscriber = controller;
          for (const chunk of current.chunks) controller.enqueue(chunk);
          if ("error" in current) {
            controller.error(current.error);
            release();
          } else if (current.complete) {
            controller.close();
            release();
          } else {
            current.subscribers.set(controller, release);
            current.ready?.();
            current.ready = undefined;
          }
          if (current.bytes > maxBytes && current.subscribers.size >= current.users)
            current.chunks = [];
        },
        cancel() {
          current.subscribers.delete(subscriber);
          release();
        },
      });
      return {
        ok: response.ok,
        status: response.status,
        headers: response.headers,
        url: response.url,
        redirected: response.redirected,
        body,
      };
    } catch (error) {
      release();
      if (!signal.aborted && stale && (error as { code?: string })?.code === "NETWORK_ERROR") {
        const response = await stale.response;
        return {
          ok: response.ok,
          status: response.status,
          headers: response.headers,
          url: response.url,
          redirected: response.redirected,
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of stale.chunks) controller.enqueue(chunk);
              controller.close();
            },
          }),
        };
      }
      throw error;
    }
  }
}
