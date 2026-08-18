---
name: togopic-figures
description: Use when creating a figure, slide deck, poster, PDF, or paper that includes illustrations from the TogoTV Togo picture gallery (the `togopic` MCP server; images with DOIs like 10.7875/togopic.*). Ensures the required CC-BY-4.0 credit ("© YYYY DBCLS TogoTV") is always placed correctly — in the figure legend for papers, small bottom-right for slides — and shows how to combine the togopic MCP with the pptx/docx/pdf document skills for polished output. Triggers on requests like "make a figure with this togo picture", "put this illustration in my slides/paper", "build a deck from togopic images", "cite this TogoTV image".
---

# Togo picture gallery — figures & slides with correct attribution

Illustrations from the Togo picture gallery are **CC-BY-4.0**, copyright **"DBCLS
TogoTV"**. They may be reused freely **only if** the credit is shown: appropriate
credit (source), a link to the license, and a note if the image was modified.
This skill keeps that credit correct while producing good-looking output.

## The two building blocks

- **`togopic` MCP** = the source of truth for the **image + citation**. It returns
  the illustration and the exact credit strings (`citation`, `citation_html`,
  `bibtex`) and can embed the credit into the file itself.
- **Document skills** (`pptx`, `docx`, `pdf`, `dataviz`) = the **layout engine** for
  polished or complex documents.

Never hand an image to a document without its credit. Prefer pulling the credit
from the MCP as data rather than retyping it.

## Decide: MCP alone, or MCP + a document skill

| Situation | Do this |
|---|---|
| One figure / a few slides, fast, guaranteed correct | **MCP alone**: `build_figure` (pdf/html) or `build_pptx`. No skill needed. |
| Real manuscript (Word, multi-column, reference list) | **`docx` skill** + MCP `bibtex` |
| Branded / designed deck | **`pptx` skill** + MCP image & citation |
| Figure combined with charts/other art | **`pptx`/`dataviz` skill** + MCP image |

The MCP's `build_*` tools are fixed templates: correct and fast. Reach for a
document skill only when you need more layout control.

## Fast path — MCP alone

1. `search_pictures` / `get_picture` to find the image (by DOI).
2. `build_figure` (`format: "pdf"` or `"html"`) for a **paper-style figure with the
   credit inside each legend**, or `build_pptx` for slides.
   - Slides default to a small license note **bottom-right** (`creditPlacement: "corner"`).
     Use `creditPlacement: "caption"` for a full legend under the image.
   - Options: `locale` (`ja`/`en`), `sourceLabel` (`"TogoTV"` or `"Togo picture gallery"`),
     `modified: true` if the image was altered, multiple `ids` for multi-figure/-slide.

## Polished path — MCP + document skill (the clean combo)

1. Pick the image with `search_pictures` / `get_picture`; keep the returned
   `citation` and `bibtex`.
2. `download_asset` (format `png` or `svg`) → a file with the **credit embedded in
   its metadata** (PNG iTXt+XMP / SVG RDF). Use **this file**, not the raw URL.
3. Build the document with the `pptx` / `docx` skill, placing that image.
4. Put the credit where it belongs:
   - **Paper**: the `citation` in the **figure legend**, and again in
     Acknowledgements; the `bibtex` in the reference list.
   - **Slides**: a compact credit **bottom-right** of the slide (e.g.
     `© YYYY DBCLS TogoTV · CC-BY-4.0` + the DOI), full credits on a closing slide.
   - Multiple images: `generate_reference` builds a combined Markdown/BibTeX block.

### Why embed with `download_asset`

When a document skill lays out the image, the MCP no longer controls the final
file, so its "always cite" guarantee weakens. The embedded PNG/SVG credit is the
backstop:

- `pptx` / `docx` skills embed the image as-is → the embedded credit **survives** in
  the final file. ✅
- `pdf` skill (Chrome) may re-encode and strip it → **rely on the visible legend**;
  always keep the printed `citation`.

## The official credit format

Base every credit on this (fields come from the MCP):

> The image of *TITLE* is from TogoTV
> (© *YYYY* DBCLS TogoTV, CC-BY-4.0 https://creativecommons.org/licenses/by/4.0/deed.ja)

Japanese: `「TITLE」の画像は TogoTV より引用 (© YYYY DBCLS TogoTV, CC-BY-4.0 …)。出典: DOI`

Copyright is **DBCLS TogoTV** (the corporate holder), not the individual
illustrator — though the illustrator may be credited additionally. The year comes
from the DOI (`togopic.YYYY.nnn`). If modified, say so (`modified` / 改変あり).
