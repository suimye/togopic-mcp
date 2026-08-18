# togopic-mcp

An [MCP](https://modelcontextprotocol.io) server for the **TogoTV Togo picture
gallery**. It lets an AI assistant search and retrieve the gallery's biology
illustrations, and — crucially — it returns the **required CC-BY-4.0 credit with
every image**, so illustrations never reach a paper, slide, or PDF without their
attribution.

- Read-only wrapper over the public `togotv-api.dbcls.jp` API. **No credentials.**
- Transport: **stdio** (Claude Desktop / Claude Code). HTTP can be added later.

## Attribution (why this server exists)

TogoTV content is licensed under **CC-BY-4.0**; copyright is held by
**"DBCLS TogoTV"**. To reuse an image you must (1) give appropriate credit,
(2) link to the license, and (3) indicate if you changed it. Official credit form:

> The image of *XX* is from TogoTV
> (© *YYYY* DBCLS TogoTV, CC-BY-4.0 https://creativecommons.org/licenses/by/4.0/deed.ja)

This server enforces that in three layers:

1. **Adjacency** — every image-bearing result carries a `citation` field.
2. **Instructions** — the server and each tool tell the model the credit is mandatory.
3. **Assets** *(planned, v0.2)* — embed attribution into the file (XMP/EXIF) so it
   survives even if the model drops the text.

## Tools

| Tool | Purpose |
|---|---|
| `search_pictures` | Search by text/tag; each hit includes its credit. |
| `get_picture` | Full metadata + all asset URLs + credit (text/html/bibtex). |
| `get_picture_asset` | Resolve one asset format's download URL + credit. |
| `generate_reference` | Build a Reference block (Markdown/BibTeX/text) for many images. |
| `list_facets` | List filter values (tags, taxonomy) to refine searches. |

## Setup

```bash
npm install
npm run build
```

### Register with Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "togopic": {
      "command": "node",
      "args": ["/absolute/path/to/togopic-mcp/dist/index.js"]
    }
  }
}
```

## Development

```bash
npm run typecheck   # type-check only
npm test            # citation unit tests
npm run dev         # tsc --watch
```

## Data source

Picture metadata is authored in a Google Spreadsheet, indexed into Elastic Search
by togotv-api, and served openly at `https://togotv-api.dbcls.jp/api/...`. This
server reads that public API — it does **not** touch the spreadsheet or any keys.
Override endpoints via `TOGOTV_API_BASE` / `TOGOPIC_IMAGE_BASE` if needed.

## License

Code: MIT. Illustration metadata and images: CC-BY-4.0, © DBCLS TogoTV.
