const pino = require("pino");

function formatArgs(args) {
  return args.map((arg) => {
    if (typeof arg === "string") {
      return arg;
    }
    if (arg instanceof Error) {
      return arg.message;
    }
    try {
      return JSON.stringify(arg);
    } catch (error) {
      return String(arg);
    }
  });
}

function isPlainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Error)
  );
}

function buildLogger(baseLogger) {
  function logWith(level, args) {
    if (!args.length) {
      return;
    }

    if (args.length === 1) {
      const [first] = args;
      if (first instanceof Error) {
        baseLogger[level]({ err: first });
        return;
      }
      baseLogger[level](first);
      return;
    }

    const [first, second, ...rest] = args;
    if (first instanceof Error) {
      baseLogger[level]({ err: first }, ...formatArgs([second, ...rest]));
      return;
    }
    if (second instanceof Error) {
      baseLogger[level]({ err: second }, ...formatArgs([first, ...rest]));
      return;
    }
    if (isPlainObject(first) && typeof second === "string") {
      baseLogger[level](first, second, ...rest);
      return;
    }
    if (typeof first === "string" && isPlainObject(second)) {
      baseLogger[level](second, first, ...rest);
      return;
    }
    baseLogger[level](formatArgs(args).join(" "));
  }

  return {
    info: (...args) => logWith("info", args),
    warn: (...args) => logWith("warn", args),
    error: (...args) => logWith("error", args),
    debug: (...args) => logWith("debug", args)
  };
}

const rootLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  timestamp: pino.stdTimeFunctions.isoTime
});

function createLogger(prefix = "") {
  const logger = prefix ? rootLogger.child({ scope: prefix }) : rootLogger;
  return buildLogger(logger);
}

const logger = createLogger();

module.exports = {
  createLogger,
  logger
};
