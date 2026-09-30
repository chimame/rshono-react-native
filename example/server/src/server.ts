import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

const server = new Hono();
server.use(bodyLimit({ maxSize: 64 * 1024 }));
server.get("/health", (c) => c.json({ name: "rshono-native-example" }));
export default server;
