"use client";
import {
  createContext,
  createElement,
  useContext,
  useMemo,
  Component,
  Suspense,
  type ReactNode,
} from "react";
import { useServerScreen } from "./provider.js";
import { controlError, RshonoError } from "./errors.js";
const Location = createContext<{ href: string; params: Record<string, string> } | null>(null);
export function RouterProvider({
  href,
  params,
  children,
}: {
  href: string;
  params: Record<string, string>;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ href, params }), [href, params]);
  return createElement(Location.Provider, { value }, children);
}
export function useNavigation() {
  const location = useContext(Location);
  const screen = useServerScreen();
  const missing = () => {
    throw new RshonoError(
      "CONFIGURATION_ERROR",
      "Pass a navigation adapter to RshonoProvider to navigate from RSHono Client Components.",
    );
  };
  return {
    url: new URL(location?.href ?? screen.url),
    params: location?.params ?? {},
    router: {
      push: screen.navigation?.push ?? missing,
      replace: screen.navigation?.replace ?? missing,
      back: screen.navigation?.back ?? missing,
      forward: screen.navigation?.forward ?? missing,
      refresh: screen.refresh,
      pending: screen.pending,
    },
  };
}
type BoundaryProps = {
  children?: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  onError?: (error: Error) => void;
  resetKeys?: readonly unknown[];
};
export class CatchBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    if (!controlError(error)) this.props.onError?.(error);
  }
  componentDidUpdate(previous: BoundaryProps) {
    if (
      (this.state.error &&
        (previous.resetKeys ?? []).some((key, i) => !Object.is(key, this.props.resetKeys?.[i]))) ||
      (this.state.error && previous.resetKeys?.length !== this.props.resetKeys?.length)
    )
      this.reset();
  }
  reset = () => this.setState({ error: null });
  render() {
    if (this.state.error) {
      if (controlError(this.state.error) || this.props.fallback === undefined)
        throw this.state.error;
      return typeof this.props.fallback === "function"
        ? this.props.fallback(this.state.error, this.reset)
        : this.props.fallback;
    }
    return this.props.children;
  }
}
export function AsyncBoundary({
  loading,
  error,
  ...props
}: Omit<BoundaryProps, "fallback"> & { loading: ReactNode; error?: BoundaryProps["fallback"] }) {
  return createElement(
    CatchBoundary,
    { ...props, fallback: error },
    createElement(Suspense, { fallback: loading }, props.children),
  );
}
