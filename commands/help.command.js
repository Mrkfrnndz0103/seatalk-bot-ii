function handleHelp() {
  return {
    text:
      "Available commands:\n" +
      "- /help\n" +
      "- /search <query>\n" +
      "- /reindex"
  };
}

module.exports = {
  handleHelp
};
