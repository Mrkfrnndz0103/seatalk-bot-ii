function handleHelp() {
  return {
    text:
      "Available commands:\n" +
      "- /help\n" +
      "- /search <query> [--ai]\n" +
      "- /reindex"
  };
}

module.exports = {
  handleHelp
};
