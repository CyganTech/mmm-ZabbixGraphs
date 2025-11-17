module.exports = {
  rootDir: __dirname,
  testEnvironment: "node",
  moduleNameMapper: {
    "^node_helper$": "<rootDir>/tests/stubs/node_helper.js"
  }
};
