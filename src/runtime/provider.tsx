import { RshonoError, httpUrl, controlError } from "./errors";
import {
  createContext,
  useContext,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getManifest } from "rshono-react-native/internal/manifest";
import {
  createNativeClient,
  mergeHeaders,
  type NativeClientOptions,
  type FlightPayload,
  type NativeClient,
} from "./transport";
import { RscView, useRsc, type RscViewProps } from "./runtime";

export type NativeNavigation = {
  push(href: string): void;
  replace(href: string): void;
  back(): void;
  forward?(): void;
};
export type LifecycleEvent = "active" | "reconnect" | "focus";
export type NativeLifecycle = { subscribe(listener: (event: LifecycleEvent) => void): () => void };
type SharedOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  fallback?: ReactNode;
  renderError?: RscViewProps["renderError"];
  onRenderError?: RscViewProps["onError"];
  streamIdleTimeoutMs?: number;
  preserveState?: boolean;
  onRedirect?: (href: string) => void;
  renderNotFound?: ReactNode;
  navigation?: NativeNavigation;
  lifecycle?: NativeLifecycle;
  refreshOn?: LifecycleEvent[];
};
export type RshonoProviderProps = SharedOptions &
  Omit<NativeClientOptions, "manifest" | "fetch"> & {
    origin: string;
    fetch?: NativeClientOptions["fetch"];
    /** Set only for a custom client. Metro normally connects the generated client automatically. */
    client?: NativeClient;
    children: ReactNode;
  };
const Context = createContext<(SharedOptions & { origin: string; client: NativeClient }) | null>(
  null,
);
export function RshonoProvider({
  origin,
  fetch: fetcher = globalThis.fetch,
  client: supplied,
  children,
  getHeaders,
  onUnauthorized,
  onRequest,
  onError,
  cacheTimeMs,
  staleIfErrorMs,
  maxCacheEntries,
  maxCacheBytes,
  ...options
}: RshonoProviderProps) {
  const manifest = supplied ? undefined : getManifest();
  const client = useMemo(
    () =>
      supplied ??
      createNativeClient({
        manifest: manifest!,
        fetch: fetcher,
        getHeaders,
        onUnauthorized,
        onRequest,
        onError,
        cacheTimeMs,
        staleIfErrorMs,
        maxCacheEntries,
        maxCacheBytes,
      }),
    [
      supplied,
      manifest,
      fetcher,
      getHeaders,
      onUnauthorized,
      onRequest,
      onError,
      cacheTimeMs,
      staleIfErrorMs,
      maxCacheEntries,
      maxCacheBytes,
    ],
  );
  return <Context.Provider value={{ origin, client, ...options }}>{children}</Context.Provider>;
}
export type ServerScreenProps = SharedOptions & {
  path: string;
  searchParams?: Record<string, string | number | boolean | null | undefined>;
  /** Change this value to refetch the same URL. */
  reloadKey?: string | number;
};
export function serverScreenUrl(
  origin: string,
  path: string,
  searchParams: ServerScreenProps["searchParams"] = {},
) {
  const base = httpUrl(origin);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    throw new RshonoError("INVALID_URL", "origin must be an HTTP(S) origin.");
  let url: URL;
  try {
    url = new URL(path, base);
  } catch (cause) {
    throw new RshonoError("INVALID_URL", "path must be a valid path.", { cause });
  }
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    url.origin !== base.origin ||
    url.username ||
    url.password
  )
    throw new RshonoError("INVALID_URL", "path must be an absolute path on the same server.");
  for (const [name, value] of Object.entries(searchParams).sort(([a], [b]) => a.localeCompare(b))) {
    if (value != null) url.searchParams.set(name, String(value));
  }
  return url.href;
}
const rethrow: RscViewProps["renderError"] = (error) => {
  throw error;
};
export type ServerScreenState = {
  url: string;
  pending: boolean;
  error: Error | null;
  refresh(): void;
  reset(): void;
  invalidate(): void;
  prefetch(path: string, searchParams?: ServerScreenProps["searchParams"]): Promise<void>;
  callServer(id: string, args: unknown[]): Promise<unknown>;
  bindServerFunction(reference: unknown, args: unknown[]): Promise<unknown>;
  navigation?: NativeNavigation;
};
const ScreenContext = createContext<ServerScreenState | null>(null);
export function useServerScreen(): ServerScreenState {
  const state = useContext(ScreenContext);
  if (!state)
    throw new RshonoError("CONFIGURATION_ERROR", "Call useServerScreen inside a ServerScreen.");
  return state;
}
/** Bind an imported Server Function to this screen without a global callback. */
export function useServerFunction<Args extends unknown[], Result>(
  reference: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  const { bindServerFunction } = useServerScreen();
  return useCallback(
    (...args: Args) => bindServerFunction(reference, args) as Promise<Result>,
    [reference, bindServerFunction],
  );
}
export function ServerScreen({ path, searchParams, reloadKey, ...overrides }: ServerScreenProps) {
  const context = useContext(Context);
  if (!context)
    throw new RshonoError("CONFIGURATION_ERROR", "Render ServerScreen inside RshonoProvider.");
  const options = {
    ...context,
    ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)),
  } as typeof context & SharedOptions;
  const headers = mergeHeaders(context.headers, overrides.headers);
  const url = serverScreenUrl(context.origin, path, searchParams);
  const identity = JSON.stringify([url, Object.entries(headers).sort()]);
  const mounted = useRef(false);
  const latestIdentity = useRef(identity);
  const [actions, setActions] = useState(0);
  const [redirect, setRedirect] = useState<string | null>(null);
  const handledRedirect = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    latestIdentity.current = identity;
    handledRedirect.current = null;
    // Synchronize control state when navigating to another server screen.
    // oxlint-disable-next-line react/set-state-in-effect
    setRedirect(null);
    return () => {
      mounted.current = false;
    };
  }, [identity]);
  const handleControl = (cause: unknown) => {
    const error = controlError(cause);
    if (error?.code === "REDIRECT" && error.location) {
      // Native navigation owns redirects, including external URLs. Never forward credentials to them.
      try {
        setRedirect(redirectUrl(error.location, url));
      } catch {
        return new RshonoError(
          "INVALID_RESPONSE",
          "The server returned an invalid redirect location.",
        );
      }
    }
    return error;
  };
  const { onRedirect, navigation, lifecycle, refreshOn } = options;
  useEffect(() => {
    if (redirect && handledRedirect.current !== redirect && (onRedirect || navigation)) {
      handledRedirect.current = redirect;
      if (onRedirect) onRedirect(redirect);
      else if (navigation) navigation.replace(redirect);
    }
  }, [redirect, onRedirect, navigation]);
  const onPayload = (payload: FlightPayload) => {
    if (payload.redirect) {
      const control = handleControl(
        new RshonoError("REDIRECT", "The server requested navigation.", {
          location: payload.redirect,
        }),
      );
      if (control?.code === "INVALID_RESPONSE") throw control;
    }
  };
  const state = useRsc({
    client: context.client,
    url,
    headers,
    timeoutMs: options.timeoutMs,
    reloadKey,
    streamIdleTimeoutMs: options.streamIdleTimeoutMs ?? 15000,
    preserveState: options.preserveState,
    onPayload,
    onError: handleControl,
  });
  const { refresh, apply, runAction } = state;
  useEffect(() => {
    if (!lifecycle || !refreshOn?.length) return;
    return lifecycle.subscribe((event) => {
      if (refreshOn.includes(event)) refresh();
    });
  }, [lifecycle, refreshOn, refresh]);
  const headerKey = JSON.stringify(headers);
  const actionAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    actionAbort.current = new AbortController();
    return () => actionAbort.current?.abort();
  }, [identity]);
  const callServer = async (id: string, args: unknown[]) => {
    if (!context.client.callServer)
      throw new RshonoError(
        "CONFIGURATION_ERROR",
        "The custom client does not implement Server Functions.",
      );
    const calledFrom = identity;
    if (mounted.current) setActions((value) => value + 1);
    try {
      const payload = (await runAction(() =>
        context.client.callServer!(url, id, args, {
          headers: JSON.parse(headerKey),
          signal: actionAbort.current?.signal,
          timeoutMs: options.timeoutMs ?? 15000,
          streamIdleTimeoutMs: options.streamIdleTimeoutMs ?? 15000,
          onPayload: (updated) => {
            if (mounted.current && latestIdentity.current === calledFrom) apply(updated);
          },
        }),
      )) as FlightPayload;
      if (mounted.current && latestIdentity.current === calledFrom) apply(payload);
      if (payload.redirect || payload.notFound) return undefined;
      if (!payload.returnValue)
        throw new RshonoError("ACTION_ERROR", "The server action produced no result.");
      if (!payload.returnValue.ok) throw payload.returnValue.error;
      return payload.returnValue.value;
    } catch (cause) {
      if (mounted.current && latestIdentity.current === calledFrom) handleControl(cause);
      throw cause;
    } finally {
      if (mounted.current) setActions((value) => value - 1);
    }
  };
  const screen: ServerScreenState = {
    url,
    pending: state.loading || !!state.refreshing || actions > 0 || !!state.actionPending,
    error: state.error,
    refresh: state.refresh,
    reset: state.reset,
    navigation: options.navigation,
    invalidate: () => {
      context.client.invalidate?.();
      state.refresh();
    },
    prefetch: async (path, query) => {
      if (!context.client.prefetch)
        throw new RshonoError(
          "CONFIGURATION_ERROR",
          "The custom client does not support prefetch.",
        );
      await context.client.prefetch(serverScreenUrl(context.origin, path, query), {
        headers: JSON.parse(headerKey),
        timeoutMs: options.timeoutMs ?? 15000,
        streamIdleTimeoutMs: options.streamIdleTimeoutMs ?? 15000,
      });
    },
    callServer,
    bindServerFunction: async (reference, args) => {
      if (!context.client.serverFunctionId)
        throw new RshonoError(
          "CONFIGURATION_ERROR",
          "The custom client does not support imported Server Functions.",
        );
      return callServer(await context.client.serverFunctionId(reference), args);
    },
  };
  const renderError: RscViewProps["renderError"] = (cause, retry) => {
    let error = controlError(cause);
    if (error?.code === "REDIRECT" && error.location) {
      try {
        redirectUrl(error.location, url);
      } catch {
        error = new RshonoError(
          "INVALID_RESPONSE",
          "The server returned an invalid redirect location.",
        );
      }
    }
    if (error?.code === "REDIRECT" && error.location && (options.onRedirect || options.navigation))
      return <ControlRedirect error={error} onRedirect={handleControl} />;
    if (error?.code === "NOT_FOUND" && options.renderNotFound !== undefined)
      return options.renderNotFound;
    return (options.renderError ?? rethrow)(error ?? cause, retry);
  };
  return (
    <ScreenContext.Provider value={screen}>
      {redirect && (options.onRedirect || options.navigation) ? null : state.notFound &&
        options.renderNotFound !== undefined ? (
        options.renderNotFound
      ) : (
        <RscView
          state={state}
          fallback={options.fallback}
          onError={(error, stack) => {
            if (!controlError(error)) options.onRenderError?.(error, stack);
          }}
          renderError={renderError}
        />
      )}
    </ScreenContext.Provider>
  );
}
function ControlRedirect({
  error,
  onRedirect,
}: {
  error: RshonoError;
  onRedirect: (error: unknown) => unknown;
}) {
  useEffect(() => {
    onRedirect(error);
  }, [error, onRedirect]);
  return null;
}

function redirectUrl(location: string, base: string): string {
  const target = new URL(location, base);
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password)
    throw new Error("Invalid redirect");
  return target.href;
}
