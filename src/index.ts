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

import { searchPictures, listPictures, getPictureById, getFacets, assetUrl } from "./api.js";
import { buildCitation, buildReferenceMarkdown, plain } from "./citation.js";
import type { AssetFormat, Picture } from "./types.js";

const localeSchema = z.enum(["ja", "en"]).default("en");

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
function summarize(p: Picture, locale: "ja" | "en") {
  const c = buildCitation(p, { locale });
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
  },
  async ({ query, tag, limit, locale }) => {
    try {
      const res =
        query || tag
          ? await searchPictures({ text: query, tag, rows: limit })
          : await listPictures({ rows: limit });
      const items = (res.data ?? []).map((p) => summarize(p, locale));
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
  },
  async ({ id, locale, modified }) => {
    try {
      const p = await getPictureById(id);
      if (!p) return errorResult(`picture not found: ${id}`);
      const c = buildCitation(p, { locale, modified });
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
  },
  async ({ id, format, locale, modified }) => {
    try {
      const p = await getPictureById(id);
      if (!p) return errorResult(`picture not found: ${id}`);
      const file = p[format as AssetFormat];
      if (!file || file === "-") {
        return errorResult(`format "${format}" not available for ${id}`);
      }
      const c = buildCitation(p, { locale, modified });
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
  },
  async ({ ids, format, locale }) => {
    try {
      const pics: Picture[] = [];
      const missing: string[] = [];
      for (const id of ids) {
        const p = await getPictureById(id);
        if (p) pics.push(p);
        else missing.push(id);
      }
      if (pics.length === 0) return errorResult(`no pictures found for: ${ids.join(", ")}`);

      let body: string;
      if (format === "bibtex") {
        body = pics.map((p) => buildCitation(p, { locale }).bibtex).join("\n\n");
      } else if (format === "text") {
        body = pics.map((p, i) => `${i + 1}. ${buildCitation(p, { locale }).text}`).join("\n");
      } else {
        body = buildReferenceMarkdown(pics, { locale });
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
