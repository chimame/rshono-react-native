import { RshonoError, httpUrl } from "./errors";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { getManifest } from "rshono-react-native/internal/manifest";
import { createNativeClient, type FlightFetch, type NativeClient } from "./transport";
import { RscView, useRsc, type RscViewProps } from "./runtime";

type SharedOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  fallback?: ReactNode;
  renderError?: RscViewProps["renderError"];
};
export type RshonoProviderProps = SharedOptions & {
  origin: string;
  fetch?: FlightFetch;
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
  ...options
}: RshonoProviderProps) {
  const client = useMemo(
    () => supplied ?? createNativeClient({ manifest: getManifest(), fetch: fetcher }),
    [supplied, fetcher],
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
export function ServerScreen({ path, searchParams, reloadKey, ...options }: ServerScreenProps) {
  const context = useContext(Context);
  if (!context)
    throw new RshonoError("CONFIGURATION_ERROR", "Render ServerScreen inside RshonoProvider.");
  const state = useRsc({
    client: context.client,
    url: serverScreenUrl(context.origin, path, searchParams),
    headers: { ...context.headers, ...options.headers },
    timeoutMs: options.timeoutMs ?? context.timeoutMs,
    reloadKey,
  });
  return (
    <RscView
      state={state}
      fallback={options.fallback !== undefined ? options.fallback : context.fallback}
      renderError={options.renderError ?? context.renderError ?? rethrow}
    />
  );
}
