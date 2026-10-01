// Jest must use the same installed runtime as RshonoProvider, including copied consumer fixtures.
const { dirname, join } = require("node:path");
module.exports = require(
  join(dirname(require.resolve("rshono-react-native")), "runtime/navigation.js"),
);
