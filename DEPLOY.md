# Deploying togopic-mcp as an HTTP endpoint

Goal: expose the server at a public URL such as **`https://togotv.dbcls.jp/mcp`**
so anyone can add it as a Claude connector without cloning anything.

The server is **read-only and holds no credentials** (it only proxies the public
`togotv-api.dbcls.jp` and fetches public images), so it is safe to expose. Add
rate limiting at the proxy if you expect heavy traffic.

## What runs

`dist/http.js` is a stateless **Streamable HTTP** MCP server:

- Listens on `PORT` (default `3000`), endpoint path `MCP_PATH` (default `/mcp`).
- `GET /health` → `{ ok: true }`.
- A fresh MCP server is built per request (no session store; scales horizontally).
- `TOGOPIC_RETURN_BYTES=1` (default in HTTP mode) makes `build_figure` /
  `build_pptx` / `download_asset` return the generated file inline as a base64
  resource instead of a local path — required, since the client is remote.

## Run with Docker (recommended — includes Chromium for PDF)

```bash
docker build -t togopic-mcp .
docker run -p 3000:3000 togopic-mcp
# → http://localhost:3000/mcp   (health: http://localhost:3000/health)
```

The image bundles Chromium (`CHROME_PATH=/usr/bin/chromium`) and Japanese fonts,
so `build_figure` PDFs render server-side.

### Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `MCP_PATH` | `/mcp` | Endpoint path |
| `TOGOPIC_RETURN_BYTES` | `1` (http) | Return files as base64 resources |
| `CHROME_PATH` | `/usr/bin/chromium` | Chrome/Chromium binary for PDF |
| `TOGOTV_API_BASE` | public API | Override the upstream API |

## Put it behind `togotv.dbcls.jp/mcp/`

`togotv.dbcls.jp` today serves the static site (S3, likely via CloudFront). Route
just the `/mcp` path to this container running on your compute (the togotv-api
EC2, an ECS service, or any small VM).

### Option A — nginx reverse proxy (on the compute host)

```nginx
location /mcp {
    proxy_pass         http://127.0.0.1:3000/mcp;
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   X-Forwarded-For $remote_addr;
    proxy_buffering    off;            # allow streaming responses
    proxy_read_timeout 120s;           # PDF/PPTX generation
}
```

### Option B — CloudFront behavior (if the domain fronts S3 via CloudFront)

Add a cache behavior for path pattern `/mcp*` whose **origin** is the compute
running this container (an ALB or the EC2), with caching disabled and all HTTP
methods + the `Accept` / `Content-Type` headers forwarded. Everything else keeps
going to the S3 origin.

> If routing a subpath is awkward, a dedicated subdomain (e.g.
> `togopic-mcp.dbcls.jp`) pointing straight at the container is simpler; set
> `MCP_PATH=/mcp` and use `https://togopic-mcp.dbcls.jp/mcp`.

## Register in Claude

Once live, add it as a **custom connector / MCP server** with the URL:

```
https://togotv.dbcls.jp/mcp
```

- Claude Code: `claude mcp add --transport http togopic https://togotv.dbcls.jp/mcp`
- claude.ai / Claude Desktop: add a custom connector with that URL (no auth).

## Verify

```bash
curl -s https://togotv.dbcls.jp/mcp/../health   # or /health at the host
curl -s -X POST https://togotv.dbcls.jp/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

You should get the list of 8 tools.
