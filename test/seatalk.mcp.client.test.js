const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {
  SeatalkMcpClient,
  unwrapMcpResult
} = require("../integrations/seatalk.mcp.client");

test("unwrapMcpResult parses JSON content", () => {
  const result = unwrapMcpResult({
    content: [{ type: "text", text: "{\"code\":0,\"ok\":true}" }]
  });
  assert.equal(result.code, 0);
  assert.equal(result.ok, true);
});

test("SeatalkMcpClient retries on rate limit", async () => {
  let callCount = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const payload = JSON.parse(body || "{}");
      let result = { code: 0 };
      if (payload.method === "tools/call") {
        callCount += 1;
        if (callCount === 1) {
          result = { code: 101 };
        } else {
          result = { code: 0, message_id: "msg_1" };
        }
      }

      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id,
          result
        })
      );
    });
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const endpoint = `http://127.0.0.1:${port}`;

  const client = new SeatalkMcpClient({
    endpoint,
    transport: "http",
    retryMax: 2,
    retryBaseMs: 1
  });

  const response = await client.callTool("send_message_to_group_chat", {
    group_id: "g1",
    message: { tag: "text", text: { content: "hi", format: 1 } }
  });

  assert.equal(response.code, 0);
  assert.equal(response.message_id, "msg_1");

  await new Promise((resolve) => server.close(resolve));
});
