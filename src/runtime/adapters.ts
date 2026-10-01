import type { NativeLifecycle, NativeNavigation, LifecycleEvent } from "./provider";
/** Expo Router adapter; no dependency on Expo's experimental RSC router. */
export function createExpoRouterAdapter(router: {
  push(href: string): void;
  replace(href: string): void;
  back(): void;
}): NativeNavigation {
  return {
    push: (href) => router.push(href),
    replace: (href) => router.replace(href),
    back: () => router.back(),
  };
}
/** Map server URLs to your application's typed React Navigation routes. */
export function createReactNavigationAdapter(
  navigation: { goBack(): void },
  navigate: (href: string, mode: "push" | "replace") => void,
): NativeNavigation {
  return {
    push: (href) => navigate(href, "push"),
    replace: (href) => navigate(href, "replace"),
    back: () => navigation.goBack(),
  };
}
/** Bridge AppState, NetInfo, and navigation focus without adding native dependencies. */
export function createNativeLifecycle(): NativeLifecycle & { emit(event: LifecycleEvent): void } {
  const listeners = new Set<(event: LifecycleEvent) => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
  };
}
