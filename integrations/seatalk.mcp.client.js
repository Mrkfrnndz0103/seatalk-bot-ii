const axios = require("axios");
const { normalizeSeatalkError } = require("./seatalk.mcp.errors");

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RETRY_MAX = 3;
const DEFAULT_RETRY_BASE_MS = 500;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unwrapMcpResult(result) {
  if (!result) {
    return result;
  }

  if (result.code !== undefined) {
    return result;
  }

  if (result.result) {
    return unwrapMcpResult(result.result);
  }

  const content = result.content;
  if (Array.isArray(content)) {
    const text = content.find((item) => item?.type === "text")?.text;
    if (text) {
      try {
        return JSON.parse(text);
      } catch (error) {
        return { code: 2, message: text };
      }
    }
  }

  return result;
}

class SeatalkMcpClient {
  constructor(options = {}) {
    this.endpoint = options.endpoint || "";
    this.transport = options.transport || "auto";
    this.serverName = options.serverName || "seatalk-mcp-server";
    this.spawnCommand = options.spawnCommand || "npx";
    this.spawnArgs = options.spawnArgs || ["-y", "seatalk-mcp-server"];
    this.spawnEnv = options.spawnEnv || {};
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.retryMax = Number.isFinite(options.retryMax)
      ? options.retryMax
      : DEFAULT_RETRY_MAX;
    this.retryBaseMs = Number.isFinite(options.retryBaseMs)
      ? options.retryBaseMs
      : DEFAULT_RETRY_BASE_MS;
    this.logger = options.logger || null;
    this.connected = false;
    this.initialized = false;
    this.rpcId = 0;
    this.sdkClient = null;
    this.sdkTransport = null;
  }

  async connect() {
    if (this.connected) {
      return;
    }

    const useEndpoint = Boolean(this.endpoint);
    if (
      this.transport === "stdio" ||
      (!useEndpoint && this.transport === "auto")
    ) {
      await this.connectStdio();
      return;
    }

    if (!useEndpoint && this.transport === "http") {
      throw new Error("MCP_ENDPOINT is required for HTTP transport.");
    }

    this.connected = true;
  }

  async connectStdio() {
    const sdk = await this.loadSdk();
    const transport = new sdk.StdioClientTransport({
      command: this.spawnCommand,
      args: this.spawnArgs,
      env: {
        ...process.env,
        ...this.spawnEnv
      }
    });
    const client = new sdk.Client(
      {
        name: "seatalk-bot",
        version: "1.0.0"
      },
      {
        capabilities: {}
      }
    );

    await client.connect(transport);
    this.sdkClient = client;
    this.sdkTransport = transport;
    this.connected = true;
  }

  async loadSdk() {
    const clientModule = await import(
      "@modelcontextprotocol/sdk/client/index.js"
    );
    const stdioModule = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    );
    return {
      Client: clientModule.Client,
      StdioClientTransport: stdioModule.StdioClientTransport
    };
  }

  async close() {
    if (this.sdkClient && this.sdkClient.close) {
      await this.sdkClient.close();
    }
    this.sdkClient = null;
    this.sdkTransport = null;
    this.connected = false;
    this.initialized = false;
  }

  async ensureInitialized() {
    if (this.initialized || !this.endpoint) {
      return;
    }

    await this.callRpc("initialize", {
      clientInfo: { name: "seatalk-bot", version: "1.0.0" },
      capabilities: {}
    });

    try {
      await this.callRpc("initialized", {});
    } catch (error) {
      // Some servers do not require initialized notification.
    }

    this.initialized = true;
  }

  async callRpc(method, params) {
    const id = ++this.rpcId;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };
    const response = await axios.post(this.endpoint, payload, {
      timeout: this.timeoutMs
    });
    if (response.data?.error) {
      const error = new Error(response.data.error.message || "MCP error");
      error.data = response.data.error;
      throw error;
    }
    return response.data?.result;
  }

  async listTools() {
    await this.ensureConnected();
    if (this.sdkClient) {
      return this.sdkClient.listTools();
    }

    await this.ensureInitialized();
    return this.callRpc("tools/list", {});
  }

  async callTool(name, args) {
    await this.ensureConnected();
    return this.callToolWithRetry(name, args);
  }

  async callToolWithRetry(name, args) {
    let attempt = 0;
    while (true) {
      try {
        const result = await this.callToolOnce(name, args);
        const payload = unwrapMcpResult(result);

        if (payload && payload.code !== undefined && payload.code !== 0) {
          const normalized = normalizeSeatalkError(payload);
          if (normalized.code === 101 && attempt < this.retryMax) {
            attempt += 1;
            await delay(this.retryBaseMs * Math.pow(2, attempt - 1));
            continue;
          }
          if (normalized.code === 100 && attempt < this.retryMax) {
            attempt += 1;
            await this.reconnect();
            continue;
          }
          const error = new Error(normalized.message);
          error.normalized = normalized;
          error.userMessage = normalized.userMessage;
          error.payload = payload;
          throw error;
        }

        return payload;
      } catch (error) {
        if (attempt < this.retryMax && this.isTransientError(error)) {
          attempt += 1;
          await delay(this.retryBaseMs * Math.pow(2, attempt - 1));
          continue;
        }
        throw error;
      }
    }
  }

  async callToolOnce(name, args) {
    if (this.sdkClient) {
      return this.sdkClient.callTool({
        name,
        arguments: args || {}
      });
    }

    await this.ensureInitialized();
    return this.callRpc("tools/call", {
      name,
      arguments: args || {}
    });
  }

  isTransientError(error) {
    if (!error) {
      return false;
    }
    if (error.isAxiosError) {
      return true;
    }
    const code = String(error.code || "");
    return ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED"].includes(code);
  }

  async ensureConnected() {
    if (!this.connected) {
      await this.connect();
    }
  }

  async reconnect() {
    await this.close();
    await this.connect();
  }
}

module.exports = {
  SeatalkMcpClient,
  unwrapMcpResult
};
