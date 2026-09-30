import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RshonoError } from "./errors";
import type { NativeClient } from "./transport";

export type UseRscOptions = {
  client: NativeClient;
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  reloadKey?: string | number;
};
export type RscState = {
  root: ReactNode;
  loading: boolean;
  error: Error | null;
  revision: number;
  reload(): void;
};
const asError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));

export function useRsc({
  client,
  url,
  headers,
  timeoutMs = 15000,
  reloadKey,
}: UseRscOptions): RscState {
  const [state, setState] = useState<Omit<RscState, "reload">>({
    root: null,
    loading: true,
    error: null,
    revision: 0,
  });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  // Avoid refetching when callers create an equivalent headers object on each render.
  const headerKey = JSON.stringify(
    Object.entries(headers ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  );
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => {
      if (!active || generation.current !== current) return;
      active = false;
      controller.abort();
      setState((previous) => ({
        ...previous,
        loading: false,
        error: new RshonoError("TIMEOUT", "Fetching the RSC payload timed out."),
      }));
    }, timeoutMs);
    // Synchronize display state with external requests started by URL or authentication header changes.
    // oxlint-disable-next-line react/set-state-in-effect
    setState((previous) => ({
      ...previous,
      root: null,
      loading: true,
      error: null,
    }));
    void client
      .load(url, {
        headers: Object.fromEntries(JSON.parse(headerKey)),
        signal: controller.signal,
      })
      .then(
        (payload) => {
          if (active && generation.current === current) {
            setState((previous) => ({
              root: payload.root,
              loading: false,
              error: null,
              revision: previous.revision + 1,
            }));
          }
        },
        (cause) => {
          if (active && generation.current === current) {
            setState((previous) => ({
              ...previous,
              loading: false,
              error: asError(cause),
            }));
          }
        },
      )
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, url, headerKey, timeoutMs, attempt, reloadKey]);
  return { ...state, reload };
}

export type RscViewProps = {
  state: RscState;
  fallback?: ReactNode;
  renderError: (error: Error, retry: () => void) => ReactNode;
};
class RenderBoundary extends Component<
  {
    children: ReactNode;
    renderError: RscViewProps["renderError"];
    retry: () => void;
  },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(cause: unknown) {
    return { error: asError(cause) };
  }
  render() {
    return this.state.error
      ? this.props.renderError(this.state.error, this.props.retry)
      : this.props.children;
  }
}
export function RscView({ state, fallback = null, renderError }: RscViewProps) {
  if (state.error) return renderError(state.error, state.reload);
  if (state.loading) return fallback;
  return (
    <RenderBoundary key={state.revision} renderError={renderError} retry={state.reload}>
      <Suspense fallback={fallback}>{state.root}</Suspense>
    </RenderBoundary>
  );
}
