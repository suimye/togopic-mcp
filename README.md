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
3. **Embedded in the asset** — `download_asset` writes the credit into the file
   itself: PNG gets iTXt text chunks (Title/Author/Copyright/Source/License) plus
   an XMP packet (dc / xmpRights / cc); SVG gets an RDF `<metadata>` block. The
   images placed by `build_pptx` are embedded the same way, so a picture pulled
   out of the `.pptx` still carries its credit.

## Tools

| Tool | Purpose |
|---|---|
| `search_pictures` | Search by text/tag; each hit includes its credit. |
| `get_picture` | Full metadata + all asset URLs + credit (text/html/bibtex). |
| `get_picture_asset` | Resolve one asset format's download URL + credit. |
| `download_asset` | Save an asset to disk with the credit **embedded in the file** (PNG iTXt+XMP / SVG RDF). |
| `generate_reference` | Build a Reference block (Markdown/BibTeX/text) for many images. |
| `build_figure` | **Paper-style figure page** (1+ images) with the credit **inside each figure legend**, plus Acknowledgements + References. `format: html` or `pdf`. Writes a file, returns its path. |
| `build_pptx` | **PowerPoint deck**: one slide per image with the credit in a caption **legend** beneath it, plus a References slide. Writes a `.pptx`, returns its path. |
| `list_facets` | List filter values (tags, taxonomy) to refine searches. |

### Deliverables: credit goes in the legend

`build_figure` and `build_pptx` render ready-to-use figures/slides with the
mandatory credit placed **in the figure legend / slide caption** (not just a
loose reference), exactly where a journal or a talk expects attribution. Both
accept multiple `ids` and share the same options.

### Common citation options (all citation-producing tools)

| Option | Values | Effect |
|---|---|---|
| `locale` | `en` \| `ja` | Wording and license deed link (`deed.en` / `deed.ja`). |
| `sourceLabel` | string | Source name in the credit. Default `"TogoTV"`; pass `"Togo picture gallery"` for the gallery name. Env: `TOGOPIC_SOURCE_LABEL`. |
| `modified` | boolean | Appends "modified / 改変あり" as CC-BY requires when you alter the image. |

### PDF rendering

`build_figure` with `format: "pdf"` renders in this order:

1. A locally installed Chrome/Chromium (fast, nothing to download). Override the
   binary with `CHROME_PATH`.
2. **Fallback:** if no Chrome is found, [puppeteer](https://pptr.dev) is used —
   but only if you installed it. It is an **opt-in** extra (not a default
   dependency) because its install downloads a bundled Chromium (~170 MB):

   ```bash
   npm install puppeteer
   ```
3. If neither is available, use `format: "html"` and print the returned
   self-contained HTML yourself.

Output directory defaults to a temp dir; override with `TOGOPIC_OUT_DIR` or
per-call `outPath`.

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
