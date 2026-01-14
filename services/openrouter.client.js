const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const clientCache = new Map();
let sdkPromise = null;

function normalizeBaseUrl(value) {
  if (!value) {
    return "";
  }
  return String(value).trim().replace(/\/+$/, "");
}

function buildCacheKey(config) {
  return [
    config.apiKey || "",
    config.baseUrl || "",
    config.appUrl || "",
    config.appTitle || ""
  ].join("|");
}

function resolveOpenRouterExport(module) {
  if (!module) {
    return null;
  }
  if (module.OpenRouter) {
    return module.OpenRouter;
  }
  if (module.default?.OpenRouter) {
    return module.default.OpenRouter;
  }
  return module.default || module;
}

async function loadOpenRouterSdk() {
  if (!sdkPromise) {
    sdkPromise = import("@openrouter/sdk");
  }
  return sdkPromise;
}

async function getOpenRouterClient(config) {
  const key = buildCacheKey(config);
  if (clientCache.has(key)) {
    return clientCache.get(key);
  }

  const module = await loadOpenRouterSdk();
  const OpenRouter = resolveOpenRouterExport(module);
  if (typeof OpenRouter !== "function") {
    throw new Error("OpenRouter SDK not available.");
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl) || DEFAULT_BASE_URL;
  const clientOptions = {
    apiKey: config.apiKey
  };
  if (baseUrl) {
    clientOptions.baseUrl = baseUrl;
    clientOptions.baseURL = baseUrl;
  }

  const client = new OpenRouter(clientOptions);
  clientCache.set(key, client);
  return client;
}

function buildFetchOptions(config) {
  const headers = {};
  if (config.appUrl) {
    headers["HTTP-Referer"] = config.appUrl;
  }
  if (config.appTitle) {
    headers["X-Title"] = config.appTitle;
  }

  const timeoutMs = Number(config.timeoutMs);
  const hasTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
  if (!Object.keys(headers).length && !hasTimeout) {
    return { fetchOptions: null, cleanup: null };
  }

  const fetchOptions = {};
  if (Object.keys(headers).length) {
    fetchOptions.headers = headers;
  }

  if (hasTimeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    fetchOptions.signal = controller.signal;
    return {
      fetchOptions,
      cleanup: () => clearTimeout(timeoutId)
    };
  }

  return { fetchOptions, cleanup: null };
}

function extractResponseText(response) {
  const directText =
    typeof response?.output_text === "string" ? response.output_text.trim() : "";
  if (directText) {
    return directText;
  }

  const output = Array.isArray(response?.output) ? response.output : [];
  const parts = [];
  output.forEach((item) => {
    if (item?.type !== "message" || !Array.isArray(item.content)) {
      return;
    }
    item.content.forEach((content) => {
      if (content?.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    });
  });

  return parts.join("").trim();
}

async function sendOpenRouterResponse(config, request) {
  if (!config?.apiKey) {
    throw new Error("Missing OpenRouter API key.");
  }

  const client = await getOpenRouterClient(config);
  const { fetchOptions, cleanup } = buildFetchOptions(config);
  const options = fetchOptions ? { fetchOptions } : undefined;

  try {
    return await client.beta.responses.send(request, options);
  } finally {
    if (typeof cleanup === "function") {
      cleanup();
    }
  }
}

module.exports = {
  extractResponseText,
  sendOpenRouterResponse
};
