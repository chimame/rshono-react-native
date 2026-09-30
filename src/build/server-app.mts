import { Hono } from "hono";
import original from "@rshono-native/original-server-app";
const app = new Hono();
app.use(async (c, next) => {
  c.header("x-rshono-native-build", __RSHONO_NATIVE_BUILD_ID__);
  await next();
});
app.route("/", original);
export default app;
