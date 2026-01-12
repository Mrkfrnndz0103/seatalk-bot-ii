const { handleHelp } = require("./help.command");
const { handleReindex } = require("./reindex.command");
const { handleSearch } = require("./search.command");

function parseCommand(text) {
  if (typeof text !== "string") {
    return null;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^([\/!])([a-z0-9_-]+)(?:\s+([\s\S]+))?$/i);
  if (!match) {
    return null;
  }

  return {
    cmd: match[2].toLowerCase(),
    args: match[3] ? match[3].trim() : ""
  };
}

async function handle(text, ctx = {}) {
  const parsed = parseCommand(text);
  if (!parsed) {
    return null;
  }

  switch (parsed.cmd) {
    case "help":
      return handleHelp();
    case "reindex":
      return handleReindex(ctx);
    case "search":
      return handleSearch(parsed.args, ctx);
    default:
      return handleHelp();
  }
}

module.exports = {
  parseCommand,
  handle
};
