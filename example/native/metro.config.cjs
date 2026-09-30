const { getDefaultConfig } = require("expo/metro-config");
const { withRshono } = require("rshono-react-native/metro");
module.exports = withRshono(getDefaultConfig(__dirname));
