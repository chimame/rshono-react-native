import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

const server = new Hono();
// Version-dependent RSC responses must not share a cache entry across app releases.
server.use("/native", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  await next();
});
server.use(bodyLimit({ maxSize: 64 * 1024 }));
server.get("/http-redirect", (c) => c.redirect("/native"));
server.get("/health", (c) => c.json({ name: "rshono-native-example" }));
export default server;
