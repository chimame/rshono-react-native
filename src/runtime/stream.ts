import { RshonoError } from "./errors";

export function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error("The connection was aborted.");
  error.name = "AbortError";
  return error;
}
export function abortable<T>(
  promise: PromiseLike<T>,
  signal: AbortSignal,
  onLateValue?: (value: T) => void,
): Promise<T> {
  if (signal.aborted) {
    promise.then(
      (value) => {
        try {
          onLateValue?.(value);
        } catch {}
      },
      () => {},
    );
    return Promise.reject(abortReason(signal));
  }
  // Flight chunks inherit Promise.prototype but their then() returns void.
  // Hermes's Promise.resolve may return such a chunk unchanged, unlike Node.
  return new Promise((resolve, reject) => {
    let aborted = false;
    const clean = () => signal.removeEventListener?.("abort", abort);
    const abort = () => {
      aborted = true;
      clean();
      reject(abortReason(signal));
    };
    signal.addEventListener?.("abort", abort, { once: true });
    try {
      promise.then(
        (value) => {
          clean();
          if (aborted) {
            try {
              onLateValue?.(value);
            } catch {}
          } else resolve(value);
        },
        (error) => {
          clean();
          reject(error);
        },
      );
    } catch (error) {
      clean();
      reject(error);
    }
  });
}
/** Own the reader until EOF, including chunks that arrive after the root decoded. */
export function monitorStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  idleMs = 0,
  onEnd?: () => void,
  onFailure?: (reason: unknown) => void,
  registerCancel?: (cancel: (reason: unknown) => void) => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ended = false;
  let fail: (reason: unknown) => void;
  const clean = () => {
    clearTimeout(timer);
    signal.removeEventListener?.("abort", abort);
    onEnd?.();
  };
  const abort = () => fail(abortReason(signal));
  const arm = () => {
    clearTimeout(timer);
    if (idleMs > 0)
      timer = setTimeout(
        () => fail(new RshonoError("TIMEOUT", "The RSC stream stopped sending data.")),
        idleMs,
      );
  };
  return new ReadableStream({
    start(controller) {
      fail = (reason) => {
        if (ended) return;
        ended = true;
        clean();
        onFailure?.(reason);
        controller.error(reason);
        void reader.cancel(reason).catch(() => {});
      };
      registerCancel?.(fail);
      signal.addEventListener?.("abort", abort, { once: true });
      if (signal.aborted) abort();
      else arm();
    },
    async pull(controller) {
      try {
        const result = await reader.read();
        if (ended) return;
        if (result.done) {
          ended = true;
          clean();
          controller.close();
          reader.releaseLock();
        } else {
          controller.enqueue(result.value);
          arm();
        }
      } catch (cause) {
        fail(cause);
      }
    },
    cancel(reason) {
      ended = true;
      clean();
      return reader.cancel(reason);
    },
  });
}
