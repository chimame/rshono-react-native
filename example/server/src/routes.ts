import { defineRoutes } from "@rshono/core";

export const routes = defineRoutes({
  routes: [
    { path: "/native", component: () => import("./page") },
    ...[
      "/native-boundaries",
      "/redirect",
      "/missing",
      "/stream",
      "/stalled",
      "/stream-error",
      "/late-redirect",
      "/late-missing",
    ].map((path) => ({ path, component: () => import("./cases") })),
  ],
  notFound: { component: () => import("./not-found") },
});
