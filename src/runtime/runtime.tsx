import {
  Component,
  Suspense,
  useCallback,
  startTransition,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RshonoError } from "./errors";
import type { NativeClient, FlightPayload } from "./transport";

export type UseRscOptions = {
  client: NativeClient;
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  reloadKey?: string | number;
  streamIdleTimeoutMs?: number;
  preserveState?: boolean;
  onPayload?: (payload: FlightPayload) => void;
  onError?: (error: Error) => void;
};
export type RscState = {
  root: ReactNode;
  loading: boolean;
  error: Error | null;
  revision: number;
  resetRevision?: number;
  refreshing?: boolean;
  actionPending?: boolean;
  notFound?: boolean;
  runAction(run: () => Promise<unknown>): Promise<unknown>;
  reload(): void;
  refresh(): void;
  reset(): void;
  apply(payload: FlightPayload): void;
};
const asError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));

export function useRsc({
  client,
  url,
  headers,
  timeoutMs = 15000,
  reloadKey,
  streamIdleTimeoutMs,
  preserveState = true,
  onPayload,
  onError,
}: UseRscOptions): RscState {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
    throw new RshonoError("CONFIGURATION_ERROR", "timeoutMs must be a finite non-negative number.");
  const [state, setState] = useState<
    Omit<RscState, "reload" | "refresh" | "reset" | "apply" | "runAction"> & {
      request?: { client: NativeClient; url: string; headerKey: string };
    }
  >({
    root: null,
    loading: true,
    error: null,
    revision: 0,
    resetRevision: 0,
    refreshing: false,
  });
  const [attempt, setAttempt] = useState(0);
  const [resetAttempt, setResetAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const reset = useCallback(() => {
    setResetAttempt((value) => value + 1);
    setAttempt((value) => value + 1);
  }, []);
  const callbacks = useRef({ onPayload, onError });
  useEffect(() => {
    callbacks.current = { onPayload, onError };
  }, [onPayload, onError]);
  const apply = useCallback((payload: FlightPayload) => {
    try {
      callbacks.current.onPayload?.(payload);
    } catch (cause) {
      setState((previous) => ({
        ...previous,
        error: asError(cause),
        loading: false,
        refreshing: false,
      }));
      return;
    }
    if (payload.redirect) {
      setState((previous) => ({
        ...previous,
        loading: false,
        refreshing: false,
        error: new RshonoError("REDIRECT", "The server requested navigation.", {
          location: payload.redirect,
        }),
      }));
      return;
    }
    if (payload.notFound && payload.root == null) {
      setState((previous) => ({
        ...previous,
        loading: false,
        refreshing: false,
        error: new RshonoError("NOT_FOUND", "The server page was not found.", { status: 404 }),
      }));
      return;
    }
    startTransition(() =>
      setState((previous) => ({
        ...previous,
        root: payload.root,
        notFound: !!payload.notFound,
        loading: false,
        refreshing: false,
        error: null,
        revision: previous.revision + 1,
      })),
    );
  }, []);
  const previousRequest = useRef<{
    client: NativeClient;
    url: string;
    headerKey: string;
    resetAttempt: number;
    reloadKey?: string | number;
  } | null>(null);
  // Avoid refetching when callers create an equivalent headers object on each render.
  const headerKey = JSON.stringify(
    Object.entries(headers ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  );
  const generation = useRef(0);
  const actionSession = useRef(new AbortController());
  const actionQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [actionCount, setActionCount] = useState(0);
  useEffect(() => {
    const session = new AbortController();
    actionSession.current = session;
    actionQueue.current = Promise.resolve();
    // Reset pending mutations when the screen identity changes.
    // oxlint-disable-next-line react/set-state-in-effect
    setActionCount(0);
    return () => session.abort();
  }, [client, url, headerKey]);
  const runAction = useCallback((run: () => Promise<unknown>) => {
    const session = actionSession.current;
    setActionCount((value) => value + 1);
    const operation = actionQueue.current
      .catch(() => {})
      .then(() => {
        if (session.signal.aborted) throw session.signal.reason ?? new Error("Screen unmounted");
        return run();
      });
    actionQueue.current = operation;
    return operation.finally(() => {
      if (actionSession.current === session && !session.signal.aborted)
        setActionCount((value) => value - 1);
    });
  }, []);
  useEffect(() => {
    const current = ++generation.current;
    const previous = previousRequest.current;
    const discard =
      !preserveState ||
      !previous ||
      previous.client !== client ||
      previous.url !== url ||
      previous.headerKey !== headerKey ||
      previous.resetAttempt !== resetAttempt;
    const forceReload = previous !== null && previous.reloadKey !== reloadKey;
    previousRequest.current = { client, url, headerKey, resetAttempt, reloadKey };
    const controller = new AbortController();
    const session = actionSession.current;
    let active = true;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            if (!active || generation.current !== current) return;
            active = false;
            controller.abort();
            setState((previous) => ({
              ...previous,
              loading: false,
              refreshing: false,
              error: new RshonoError("TIMEOUT", "Fetching the RSC payload timed out."),
            }));
          }, timeoutMs)
        : undefined;
    // Synchronize display state with external requests started by URL or authentication header changes.
    // oxlint-disable-next-line react/set-state-in-effect
    setState((previous) => ({
      ...previous,
      root: discard ? null : previous.root,
      request: { client, url, headerKey },
      resetRevision: discard ? (previous.resetRevision ?? 0) + 1 : previous.resetRevision,
      loading: discard || previous.loading,
      refreshing: !discard && !previous.loading,
      error: null,
      notFound: false,
    }));
    void client
      .load(url, {
        headers: Object.fromEntries(JSON.parse(headerKey)),
        signal: controller.signal,
        actionSignal: session.signal,
        scheduleAction: runAction,
        onControl: (error) => {
          if (actionSession.current === session && !session.signal.aborted) {
            try {
              callbacks.current.onError?.(error);
            } catch {
              /* Reporting must not strand request state. */
            }
            setState((previous) => ({ ...previous, error, loading: false, refreshing: false }));
          }
        },
        timeoutMs,
        streamIdleTimeoutMs,
        cache: !forceReload && attempt === 0 && resetAttempt === 0,
        onPayload: (payload) => {
          if (actionSession.current === session && !session.signal.aborted) apply(payload);
        },
      })
      .then(
        (payload) => {
          if (active && generation.current === current) {
            apply(payload);
          }
        },
        (cause) => {
          if (active && generation.current === current) {
            try {
              callbacks.current.onError?.(asError(cause));
            } catch {
              /* Reporting must not strand request state. */
            }
            setState((previous) => ({
              ...previous,
              loading: false,
              refreshing: false,
              error: asError(cause),
            }));
          }
        },
      )
      .catch((cause) => {
        if (active && generation.current === current)
          setState((previous) => ({
            ...previous,
            error: asError(cause),
            loading: false,
            refreshing: false,
          }));
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    client,
    url,
    headerKey,
    timeoutMs,
    streamIdleTimeoutMs,
    preserveState,
    attempt,
    resetAttempt,
    reloadKey,
    apply,
    runAction,
  ]);
  const requestChanged =
    state.request &&
    (state.request.client !== client ||
      state.request.url !== url ||
      state.request.headerKey !== headerKey);
  const display = requestChanged
    ? { ...state, root: null, loading: true, refreshing: false, error: null }
    : state;
  return {
    ...display,
    reload,
    refresh: reload,
    reset,
    apply,
    runAction,
    actionPending: actionCount > 0,
  };
}

export type RscViewProps = {
  state: RscState;
  fallback?: ReactNode;
  renderError: (error: Error, retry: () => void) => ReactNode;
  onError?: (error: Error, componentStack: string | null | undefined) => void;
};
class RenderBoundary extends Component<
  {
    children: ReactNode;
    renderError: RscViewProps["renderError"];
    retry: () => void;
    revision: number;
    onError?: RscViewProps["onError"];
  },
  { error: Error | null; revision: number }
> {
  state = { error: null as Error | null, revision: -1 };
  static getDerivedStateFromError(cause: unknown) {
    return { error: asError(cause) };
  }
  static getDerivedStateFromProps(props: { revision: number }, state: { revision: number }) {
    return props.revision !== state.revision ? { error: null, revision: props.revision } : null;
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    this.props.onError?.(error, info.componentStack);
  }
  render() {
    return this.state.error
      ? this.props.renderError(this.state.error, this.props.retry)
      : this.props.children;
  }
}
export function RscView({ state, fallback = null, renderError, onError }: RscViewProps) {
  if (state.error && state.root === null) return renderError(state.error, state.reload);
  if (state.loading) return fallback;
  return (
    <>
      <RenderBoundary
        key={state.resetRevision ?? 0}
        revision={state.revision}
        onError={onError}
        renderError={renderError}
        retry={state.reload}
      >
        <Suspense fallback={fallback}>{state.root}</Suspense>
      </RenderBoundary>
      {state.error ? renderError(state.error, state.reload) : null}
    </>
  );
}
