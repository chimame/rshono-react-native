import { defineRoutes } from "@rshono/core";

export const routes = defineRoutes({
  routes: [{ path: "/native", component: () => import("./page") }],
});
