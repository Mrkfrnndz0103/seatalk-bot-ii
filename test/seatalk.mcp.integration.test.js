const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { SeatalkMcpClient } = require("../integrations/seatalk.mcp.client");

test("MCP HTTP mock responds to tools/list", async () => {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const payload = JSON.parse(body || "{}");
      const result =
        payload.method === "tools/list"
          ? {
              tools: [
                { name: "get_employee_profile" },
                { name: "send_message_to_group_chat" }
              ]
            }
          : {};
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
    transport: "http"
  });

  const tools = await client.listTools();
  assert.ok(Array.isArray(tools.tools));
  assert.equal(tools.tools[0].name, "get_employee_profile");

  await new Promise((resolve) => server.close(resolve));
});
