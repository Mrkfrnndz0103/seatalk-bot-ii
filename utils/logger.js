function formatArgs(args) {
  return args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)));
}

function createLogger(prefix = "") {
  const label = prefix ? `[${prefix}]` : "";

  function logWith(method, args) {
    const parts = [new Date().toISOString(), label, ...formatArgs(args)].filter(
      Boolean
    );
    console[method](parts.join(" "));
  }

  return {
    info: (...args) => logWith("log", args),
    warn: (...args) => logWith("warn", args),
    error: (...args) => logWith("error", args),
    debug: (...args) => logWith("log", args)
  };
}

const logger = createLogger();

module.exports = {
  createLogger,
  logger
};
