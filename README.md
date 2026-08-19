# togopic-mcp

An [MCP](https://modelcontextprotocol.io) server for the **TogoTV Togo picture
gallery**. It lets an AI assistant (Claude Desktop / Claude Code) search and
retrieve the gallery's biology illustrations, build ready-to-use figures and
slides from them, and — crucially — attach the **required CC-BY-4.0 credit to
every image**, so illustrations never reach a paper, slide, or PDF without their
attribution.

- Read-only wrapper over the public `togotv-api.dbcls.jp` API. **No credentials.**
- Transport: **stdio** (Claude Desktop / Claude Code). HTTP can be added later.

---

## Requirements

- **Node.js 18+** (uses the built-in `fetch`).
- For `build_figure` with `format: "pdf"`: a local **Chrome/Chromium**, or
  **puppeteer** (`npm install puppeteer`), or just use `format: "html"`.
  `build_pptx` needs nothing extra.

## 1. Install

```bash
git clone https://github.com/suimye/togopic-mcp.git
cd togopic-mcp
npm install
npm run build      # compiles TypeScript to dist/
```

This produces `dist/index.js`, the server entry point.

## 2. Add it to Claude

### Claude Desktop

Edit the config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add a `togopic` entry under `mcpServers` (keep any existing servers). Use an
**absolute** path to `dist/index.js`, and a full path to `node` if Claude Desktop
doesn't see your shell's Node (e.g. with nvm):

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

Then **fully quit and reopen Claude Desktop** (⌘Q — closing the window is not
enough). The 🔨 tools menu should now list `togopic` with its tools.

### Claude Code

```bash
claude mcp add togopic node /absolute/path/to/togopic-mcp/dist/index.js
```

(or add the same JSON block to your Claude Code MCP settings). Restart the
session so the tools load.

### After changing the code

Re-run `npm run build`, then **restart Claude** — a running MCP process keeps the
old `dist/`.

## 3. (Optional) Enable the companion skill

`skills/togopic-figures/SKILL.md` teaches Claude the citation-correct workflow
(when to use the MCP alone vs. combine it with the `pptx` / `docx` / `pdf`
document skills). Enable it for Claude Code:

```bash
mkdir -p ~/.claude/skills
ln -s "$(pwd)/skills/togopic-figures" ~/.claude/skills/togopic-figures
```

---

## Usage

Talk to Claude in plain language once the server is registered. Examples (the
prompts are what you type; Claude calls the tools for you):

**Search and cite**

> togopic で「eyelid」を検索して、最初の1件の画像URLと引用文を見せて
>
> *(Search togopic for "eyelid" and show the first result's image URL and credit.)*

**Paper-style figure (PDF), credit inside the legend**

> その画像で論文用の図をPDFで作って。図のlegendに引用を入れて
>
> *(Build a paper-style figure PDF from that image, credit in the legend.)*

**Slides, small license bottom-right**

> eyelidの画像で発表スライド(pptx)を作って。右下に小さくライセンスを入れて

**Download the image with the credit embedded in the file**

> その画像を、クレジットを埋め込んだPNGとしてダウンロードして

**A reference list / BibTeX for several images**

> これらのDOIの画像の出典リストをBibTeXで作って: 10.7875/togopic.2026.036, ...

**Combine with a document skill (polished manuscript)**

> togopicの下眼瞼コロボーマの画像を使って、Wordで論文の図と参考文献を作って
>
> Claude will pull the credit-embedded PNG + BibTeX from togopic and lay it out
> with the `docx` skill, keeping the credit in the legend and references.

The credit comes back with every image, so you can always paste it into a figure
legend, an Acknowledgement, or a slide corner.

---

## Tools

| Tool | Purpose |
|---|---|
| `search_pictures` | Search by text/tag; each hit includes its credit. |
| `get_picture` | Full metadata + all asset URLs + credit (text/html/bibtex). |
| `get_picture_asset` | Resolve one asset format's download URL + credit. |
| `download_asset` | Save an asset to disk with the credit **embedded in the file** (PNG iTXt+XMP / SVG RDF). |
| `generate_reference` | Build a Reference block (Markdown/BibTeX/text) for many images. |
| `build_figure` | **Paper-style figure page** (1+ images) with the credit **inside each figure legend**, plus Acknowledgements + References. `format: html` or `pdf`. Writes a file, returns its path. |
| `build_pptx` | **PowerPoint deck**: one slide per image. Default: small license note **bottom-right** (`creditPlacement: "corner"`); `"caption"` for a full legend. Plus a References slide. Writes a `.pptx`, returns its path. |
| `list_facets` | List filter values (tags, taxonomy) to refine searches. |

### Common options (all citation-producing tools)

| Option | Values | Effect |
|---|---|---|
| `locale` | `en` \| `ja` | Wording and license deed link (`deed.en` / `deed.ja`). |
| `sourceLabel` | string | Source name in the credit. Default `"TogoTV"`; pass `"Togo picture gallery"` for the gallery name. Env: `TOGOPIC_SOURCE_LABEL`. |
| `modified` | boolean | Appends "modified / 改変あり" as CC-BY requires when you alter the image. |
| `creditPlacement` | `corner` \| `caption` | `build_pptx` only: license bottom-right vs. full legend under the image. |

### PDF rendering

`build_figure` with `format: "pdf"` renders in this order:

1. A locally installed Chrome/Chromium (fast, nothing to download). Override the
   binary with `CHROME_PATH`.
2. **Fallback:** if no Chrome is found, [puppeteer](https://pptr.dev) is used —
   but only if you installed it. It is an **opt-in** extra (not a default
   dependency) because its install downloads a bundled Chromium (~170 MB):
   `npm install puppeteer`.
3. If neither is available, use `format: "html"` and print the returned
   self-contained HTML yourself.

Output directory defaults to a temp dir; override with `TOGOPIC_OUT_DIR` or
per-call `outPath`.

---

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

---

## Development

```bash
npm run typecheck   # type-check only
npm test            # unit tests (citation + embed)
npm run dev         # tsc --watch
```

## Data source

Picture metadata is authored in a Google Spreadsheet, indexed into Elastic Search
by togotv-api, and served openly at `https://togotv-api.dbcls.jp/api/...`. This
server reads that public API — it does **not** touch the spreadsheet or any keys.
Override endpoints via `TOGOTV_API_BASE` / `TOGOPIC_IMAGE_BASE` if needed.

## License

Code: MIT. Illustration metadata and images: CC-BY-4.0, © DBCLS TogoTV.
