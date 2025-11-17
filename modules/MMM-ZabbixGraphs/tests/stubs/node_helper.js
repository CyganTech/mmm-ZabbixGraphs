module.exports = {
  create(definition) {
    return {
      sendSocketNotification() {},
      ...definition
    };
  }
};
