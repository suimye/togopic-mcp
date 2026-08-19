#!/usr/bin/env node
/**
 * HTTP entry point for togopic-mcp (Streamable HTTP transport).
 *
 * Stateless: a fresh MCP server + transport is created per request, so it scales
 * horizontally and needs no session store. Meant to sit behind a reverse proxy,
 * e.g. mounted at https://togotv.dbcls.jp/mcp/.
 *
 * Env:
 *   PORT               listen port (default 3000)
 *   MCP_PATH           request path (default "/mcp")
 *   TOGOPIC_RETURN_BYTES=1  return generated files inline as base64 (set here)
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createMcpServer } from "./index.js";

// Over HTTP the client is remote; return file bytes, not local paths.
process.env.TOGOPIC_RETURN_BYTES = process.env.TOGOPIC_RETURN_BYTES ?? "1";

const PORT = Number(process.env.PORT ?? 3000);
const MCP_PATH = process.env.MCP_PATH ?? "/mcp";

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : undefined;
}

function jsonRpcError(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

const httpServer = createHttpServer(async (req, res) => {
  setCors(res);
  const path = (req.url ?? "").split("?")[0];

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Simple health check.
  if (req.method === "GET" && (path === "/" || path === "/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, name: "togopic-mcp", endpoint: MCP_PATH }));
    return;
  }

  if (path !== MCP_PATH) {
    jsonRpcError(res, 404, `Not found. MCP endpoint is ${MCP_PATH}`);
    return;
  }

  // Stateless: reject GET/DELETE (no server-initiated streams or sessions).
  if (req.method !== "POST") {
    jsonRpcError(res, 405, "Method not allowed; POST JSON-RPC to this endpoint.");
    return;
  }

  try {
    const body = await readBody(req);
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error("request error:", err);
    if (!res.headersSent) jsonRpcError(res, 500, (err as Error).message);
  }
});

httpServer.listen(PORT, () => {
  console.error(`togopic-mcp HTTP listening on :${PORT}${MCP_PATH}`);
});
