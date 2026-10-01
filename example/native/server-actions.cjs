// Resolve by source identity rather than the order of discovered action files.
module.exports = require("./.rshono-native/native-client.cjs").serverModules[
  "../server/src/actions.ts"
];
