#!/usr/bin/env node
/**
 * togopic-mcp — MCP server for the TogoTV Togo picture gallery.
 *
 * Every tool that surfaces an image also returns the required CC-BY-4.0 credit,
 * so an image is never handed to a model without its attribution attached.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

import { searchPictures, listPictures, getPictureById, getFacets, assetUrl } from "./api.js";
import { buildCitation, buildReferenceMarkdown, plain, bareDoi } from "./citation.js";
import { fetchImageAsDataUri } from "./assets.js";
import { buildFigureHtml, type FigureEntry } from "./figure.js";
import { buildPptx } from "./pptx.js";
import { htmlToPdf } from "./render.js";
import type { AssetFormat, Picture } from "./types.js";

const localeSchema = z.enum(["ja", "en"]).default("en");
const sourceLabelSchema = z
  .string()
  .optional()
  .describe('Source label in the credit. Default "TogoTV"; use "Togo picture gallery" for the gallery name.');

const OUT_DIR = process.env.TOGOPIC_OUT_DIR ?? tmpdir();

/** Fetch pictures + their PNG images for the given ids (for figure/pptx output). */
async function resolveEntries(ids: string[]): Promise<{ entries: FigureEntry[]; missing: string[] }> {
  const entries: FigureEntry[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const p = await getPictureById(id);
    if (!p || !p.png || p.png === "-") {
      missing.push(id);
      continue;
    }
    const image = await fetchImageAsDataUri(assetUrl(p.png));
    entries.push({ picture: p, image });
  }
  return { entries, missing };
}

/** Safe output file name from the first DOI. */
function outName(entries: FigureEntry[], ext: string): string {
  const base = bareDoi(entries[0].picture.id).replace(/[^\w]+/g, "_") || "togopic";
  const suffix = entries.length > 1 ? `_and_${entries.length - 1}_more` : "";
  return join(OUT_DIR, `${base}${suffix}.${ext}`);
}

const server = new McpServer(
  { name: "togopic-mcp", version: "0.1.0" },
  {
    instructions:
      "Search and retrieve illustrations from the TogoTV Togo picture gallery. " +
      "MANDATORY ATTRIBUTION: every image is licensed CC-BY-4.0 with copyright held by " +
      '"DBCLS TogoTV". Whenever you use one of these images in a paper, figure, slide, ' +
      "poster, press release, PDF, or any other output, you MUST include the credit string " +
      "returned in each result (the `citation` field), and for multiple images you MUST call " +
      "`generate_reference` and embed its Markdown into the deliverable (e.g. an " +
      "Acknowledgement section or figure legend). Using an image without its credit violates " +
      "the license. If the image was modified, pass modified:true so the credit says so.",
  }
);

/** Compact, model-facing view of a picture with its credit attached. */
function summarize(p: Picture, locale: "ja" | "en", sourceLabel?: string) {
  const c = buildCitation(p, { locale, sourceLabel });
  return {
    id: p.id,
    name: p.name,
    name_en: p.name_en,
    illustrator: plain(p.author_str || p.author) || undefined,
    tags: p.other_tags_comma,
    taxon: [p.taxon1, p.taxon2].filter(Boolean).join(" / ") || undefined,
    thumbnail_url: p.png && p.png !== "-" ? assetUrl(p.png) : undefined,
    doi: c.doi,
    citation: c.text,
  };
}

function textResult(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

server.tool(
  "search_pictures",
  "Search Togo picture gallery illustrations by free text and/or tag. Each result " +
    "includes the mandatory CC-BY-4.0 credit in its `citation` field.",
  {
    query: z.string().optional().describe("Free-text query (ja or en)."),
    tag: z.string().optional().describe("Filter by an exact tag (other_tags)."),
    limit: z.number().int().min(1).max(100).default(20),
    locale: localeSchema,
    sourceLabel: sourceLabelSchema,
  },
  async ({ query, tag, limit, locale, sourceLabel }) => {
    try {
      const res =
        query || tag
          ? await searchPictures({ text: query, tag, rows: limit })
          : await listPictures({ rows: limit });
      const items = (res.data ?? []).map((p) => summarize(p, locale, sourceLabel));
      return textResult({ count: items.length, items });
    } catch (e) {
      return errorResult(`search failed: ${(e as Error).message}`);
    }
  }
);

server.tool(
  "get_picture",
  "Get full metadata, all downloadable asset URLs, and the mandatory credit " +
    "(text / html / bibtex) for one picture identified by its DOI.",
  {
    id: z.string().describe("DOI URL or bare DOI, e.g. 10.7875/togopic.2026.036"),
    locale: localeSchema,
    modified: z.boolean().default(false).describe("Set true if you altered the image."),
    sourceLabel: sourceLabelSchema,
  },
  async ({ id, locale, modified, sourceLabel }) => {
    try {
      const p = await getPictureById(id);
      if (!p) return errorResult(`picture not found: ${id}`);
      const c = buildCitation(p, { locale, modified, sourceLabel });
      const formats: AssetFormat[] = [
        "png", "svg", "ai", "apng", "rotation",
        "obj_mtl_zip", "monotone_png", "monotone_svg", "detail_image1",
      ];
      const assets: Record<string, string> = {};
      for (const f of formats) {
        const v = p[f];
        if (v && v !== "-") assets[f] = assetUrl(v);
      }
      return textResult({
        id: p.id,
        name: p.name,
        name_en: p.name_en,
        scientific_name: p.scientific_name,
        illustrator: plain(p.author_str || p.author) || undefined,
        editor: plain(p.editor) || undefined,
        publisher: p.publisher,
        taxon: [p.taxon1, p.taxon2].filter(Boolean).join(" / ") || undefined,
        tax_id: p.tax_id,
        tags: p.other_tags_comma,
        description: plain(p.Description_small) || undefined,
        assets,
        citation: c.text,
        citation_html: c.html,
        bibtex: c.bibtex,
        license: "CC-BY-4.0",
      });
    } catch (e) {
      return errorResult(`get_picture failed: ${(e as Error).message}`);
    }
  }
);

server.tool(
  "get_picture_asset",
  "Resolve the download URL for a specific asset format of a picture, together " +
    "with the mandatory credit. Returns a URL (v0.1 does not stream bytes).",
  {
    id: z.string().describe("DOI URL or bare DOI."),
    format: z
      .enum([
        "png", "svg", "ai", "apng", "rotation",
        "obj_mtl_zip", "monotone_png", "monotone_svg", "detail_image1",
      ])
      .default("png"),
    locale: localeSchema,
    modified: z.boolean().default(false),
    sourceLabel: sourceLabelSchema,
  },
  async ({ id, format, locale, modified, sourceLabel }) => {
    try {
      const p = await getPictureById(id);
      if (!p) return errorResult(`picture not found: ${id}`);
      const file = p[format as AssetFormat];
      if (!file || file === "-") {
        return errorResult(`format "${format}" not available for ${id}`);
      }
      const c = buildCitation(p, { locale, modified, sourceLabel });
      return textResult({
        id: p.id,
        format,
        url: assetUrl(file),
        citation: c.text,
        citation_html: c.html,
        license: "CC-BY-4.0",
        reminder:
          "You MUST display this credit wherever the image is used (figure legend, " +
          "slide, Acknowledgement, etc.).",
      });
    } catch (e) {
      return errorResult(`get_picture_asset failed: ${(e as Error).message}`);
    }
  }
);

server.tool(
  "generate_reference",
  "Build a Reference block (Markdown, BibTeX, or plain text) for a set of pictures. " +
    "Call this and embed the output into any paper / slide deck / PDF that uses the images.",
  {
    ids: z.array(z.string()).min(1).describe("DOI URLs or bare DOIs."),
    format: z.enum(["markdown", "bibtex", "text"]).default("markdown"),
    locale: localeSchema,
    sourceLabel: sourceLabelSchema,
  },
  async ({ ids, format, locale, sourceLabel }) => {
    try {
      const pics: Picture[] = [];
      const missing: string[] = [];
      for (const id of ids) {
        const p = await getPictureById(id);
        if (p) pics.push(p);
        else missing.push(id);
      }
      if (pics.length === 0) return errorResult(`no pictures found for: ${ids.join(", ")}`);

      const opts = { locale, sourceLabel };
      let body: string;
      if (format === "bibtex") {
        body = pics.map((p) => buildCitation(p, opts).bibtex).join("\n\n");
      } else if (format === "text") {
        body = pics.map((p, i) => `${i + 1}. ${buildCitation(p, opts).text}`).join("\n");
      } else {
        body = buildReferenceMarkdown(pics, opts);
      }
      const note = missing.length ? `\n\n(not found: ${missing.join(", ")})` : "";
      return { content: [{ type: "text" as const, text: body + note }] };
    } catch (e) {
      return errorResult(`generate_reference failed: ${(e as Error).message}`);
    }
  }
);

server.tool(
  "list_facets",
  "List available filter values (e.g. tags or taxonomy) to refine searches.",
  { key: z.string().default("other_tags").describe('e.g. "other_tags", "taxon1".') },
  async ({ key }) => {
    try {
      return textResult(await getFacets(key));
    } catch (e) {
      return errorResult(`list_facets failed: ${(e as Error).message}`);
    }
  }
);

server.tool(
  "build_figure",
  "Build a paper-style figure page for one or more pictures, with the mandatory " +
    "CC-BY-4.0 credit placed INSIDE each figure legend, plus Acknowledgements and " +
    "References. format:'html' returns self-contained HTML (and writes a file); " +
    "format:'pdf' also renders a PDF via a local Chrome. Returns the output file path.",
  {
    ids: z.array(z.string()).min(1).describe("DOI URLs or bare DOIs, in figure order."),
    format: z.enum(["html", "pdf"]).default("pdf"),
    locale: localeSchema,
    sourceLabel: sourceLabelSchema,
    modified: z.boolean().default(false).describe("Set true if any image was altered."),
    title: z.string().optional().describe("Optional document title above the figures."),
    outPath: z.string().optional().describe("Absolute output path; default is a temp dir."),
  },
  async ({ ids, format, locale, sourceLabel, modified, title, outPath }) => {
    try {
      const { entries, missing } = await resolveEntries(ids);
      if (entries.length === 0) return errorResult(`no usable pictures for: ${ids.join(", ")}`);
      const html = buildFigureHtml(entries, { locale, sourceLabel, modified, title });

      if (format === "html") {
        const out = outPath ?? outName(entries, "html");
        await writeFile(out, html, "utf8");
        return textResult({ format, path: out, figures: entries.length, missing, html });
      }
      const out = outPath ?? outName(entries, "pdf");
      await htmlToPdf(html, out);
      return textResult({
        format,
        path: out,
        figures: entries.length,
        missing,
        note: "Credit is embedded in every figure legend, Acknowledgements, and References.",
      });
    } catch (e) {
      return errorResult(`build_figure failed: ${(e as Error).message}`);
    }
  }
);

server.tool(
  "build_pptx",
  "Build a PowerPoint (.pptx): one slide per picture with the image centered and the " +
    "mandatory CC-BY-4.0 credit in a caption legend beneath it, plus a References slide. " +
    "Returns the output .pptx file path.",
  {
    ids: z.array(z.string()).min(1).describe("DOI URLs or bare DOIs, one slide each."),
    locale: localeSchema,
    sourceLabel: sourceLabelSchema,
    modified: z.boolean().default(false).describe("Set true if any image was altered."),
    title: z.string().optional(),
    outPath: z.string().optional().describe("Absolute .pptx output path; default is a temp dir."),
  },
  async ({ ids, locale, sourceLabel, modified, title, outPath }) => {
    try {
      const { entries, missing } = await resolveEntries(ids);
      if (entries.length === 0) return errorResult(`no usable pictures for: ${ids.join(", ")}`);
      const out = outPath ?? outName(entries, "pptx");
      await buildPptx(entries, out, { locale, sourceLabel, modified, title });
      return textResult({
        path: out,
        slides: entries.length,
        missing,
        note: "Credit is in each slide's caption legend and on the References slide.",
      });
    } catch (e) {
      return errorResult(`build_pptx failed: ${(e as Error).message}`);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout is reserved for the MCP protocol.
  console.error("togopic-mcp running on stdio");
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
