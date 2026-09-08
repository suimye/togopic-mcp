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
import { join, basename } from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { searchPictures, listPictures, getPictureById, getFacets, assetUrl } from "./api.js";
import { buildCitation, buildReferenceMarkdown, plain, bareDoi } from "./citation.js";
import { fetchImageBuffer, toEmbedded, loadImageFile, fetchImageAsDataUri, type EmbeddedImage } from "./assets.js";
import { attributionMeta, embedPngAttribution, embedSvgAttribution } from "./embed.js";
import { externalCredit } from "./sources.js";
import { fetchBioArt } from "./bioart.js";
import { buildFigureHtml, type FigureEntry } from "./figure.js";
import { buildPptx } from "./pptx.js";
import { buildDiagram, type DiagramStep } from "./diagram.js";
import { buildAnnotatedImage, hasCloseup, type Annotation } from "./annotate.js";
import { htmlToPdf } from "./render.js";
import type { AssetFormat, Picture } from "./types.js";

const localeSchema = z.enum(["ja", "en"]).default("en");
const sourceLabelSchema = z
  .string()
  .optional()
  .describe('Source label in the credit. Default "TogoTV"; use "Togo picture gallery" for the gallery name.');

const OUT_DIR = process.env.TOGOPIC_OUT_DIR ?? tmpdir();

/** Annotation shapes drawn on top of an illustration (coords are 0-1 fractions). */
const annotationSchema = z.union([
  z.object({
    type: z.literal("callout"),
    text: z.string(),
    at: z.tuple([z.number(), z.number()]).describe("[x,y] point on the image, 0-1"),
    place: z.enum(["top", "bottom", "left", "right"]).optional(),
    style: z.enum(["leader", "wedge"]).optional(),
  }),
  z.object({
    type: z.literal("marker"),
    at: z.tuple([z.number(), z.number()]),
    label: z.string().optional(),
    radius: z.number().optional(),
  }),
  z.object({
    type: z.literal("highlight"),
    rect: z.tuple([z.number(), z.number(), z.number(), z.number()]).describe("[x,y,w,h] region, 0-1"),
    shape: z.enum(["rect", "ellipse"]).optional(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("closeup"),
    rect: z.tuple([z.number(), z.number(), z.number(), z.number()]).describe("[x,y,w,h] region to magnify, 0-1"),
    scale: z.number().optional(),
    label: z.string().optional(),
    shape: z.enum(["rect", "ellipse"]).optional(),
  }),
]);

/** Fetch pictures + their PNG images for the given ids (for figure/pptx output).
 *  The PNG bytes carry embedded attribution (layer 3), so any media extracted
 *  from the resulting .pptx still holds the credit. */
async function resolveEntries(
  ids: string[],
  opts: { locale: "ja" | "en"; sourceLabel?: string; modified?: boolean }
): Promise<{ entries: FigureEntry[]; missing: string[] }> {
  const entries: FigureEntry[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const p = await getPictureById(id);
    if (!p || !p.png || p.png === "-") {
      missing.push(id);
      continue;
    }
    const { buf, mime } = await fetchImageBuffer(assetUrl(p.png));
    const meta = attributionMeta(p, opts);
    const embedded = mime === "image/png" ? embedPngAttribution(buf, meta) : buf;
    entries.push({ picture: p, image: toEmbedded(embedded, mime) });
  }
  return { entries, missing };
}

/** Safe output file name from the first DOI. */
function outName(entries: FigureEntry[], ext: string): string {
  const base = bareDoi(entries[0].picture.id).replace(/[^\w]+/g, "_") || "togopic";
  const suffix = entries.length > 1 ? `_and_${entries.length - 1}_more` : "";
  return join(OUT_DIR, `${base}${suffix}.${ext}`);
}

/** When served over HTTP the client is remote, so a local file path is useless;
 *  return the generated file inline as a base64 resource instead. Stdio keeps
 *  returning the path (local file access). Toggle with TOGOPIC_RETURN_BYTES=1.
 *  Read at call time so the HTTP entry can set the env after this module loads. */
async function fileResult(path: string, mimeType: string, meta: Record<string, unknown>) {
  if (process.env.TOGOPIC_RETURN_BYTES !== "1") {
    return { content: [{ type: "text" as const, text: JSON.stringify({ ...meta, path }, null, 2) }] };
  }
  const blob = (await readFile(path)).toString("base64");
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ ...meta, filename: basename(path) }, null, 2) },
      {
        type: "resource" as const,
        resource: { uri: `file:///${basename(path)}`, mimeType, blob },
      },
    ],
  };
}

/** Build a fully-registered MCP server. A fresh instance is created per stdio
 *  process, and per request in the stateless HTTP entry point. */
export function createServer(): McpServer {
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
          "slide, Acknowledgement, etc.). For a file with the credit embedded in its " +
          "metadata, use download_asset instead.",
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
      const { entries, missing } = await resolveEntries(ids, { locale, sourceLabel, modified });
      if (entries.length === 0) return errorResult(`no usable pictures for: ${ids.join(", ")}`);
      const html = buildFigureHtml(entries, { locale, sourceLabel, modified, title });

      if (format === "html") {
        const out = outPath ?? outName(entries, "html");
        await writeFile(out, html, "utf8");
        return textResult({ format, path: out, figures: entries.length, missing, html });
      }
      const out = outPath ?? outName(entries, "pdf");
      await htmlToPdf(html, out);
      return fileResult(out, "application/pdf", {
        format,
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
  "Build a PowerPoint (.pptx): one slide per picture (title + image), a compact " +
    "CC-BY-4.0 license note in the bottom-right corner by default, plus a References " +
    "slide with the full credits. Use creditPlacement:'caption' for a full legend " +
    "beneath the image instead. Returns the output .pptx file path.",
  {
    ids: z.array(z.string()).min(1).describe("DOI URLs or bare DOIs, one slide each."),
    creditPlacement: z
      .enum(["corner", "caption"])
      .default("corner")
      .describe("'corner' = small license note bottom-right; 'caption' = full legend below image."),
    locale: localeSchema,
    sourceLabel: sourceLabelSchema,
    modified: z.boolean().default(false).describe("Set true if any image was altered."),
    title: z.string().optional(),
    outPath: z.string().optional().describe("Absolute .pptx output path; default is a temp dir."),
  },
  async ({ ids, creditPlacement, locale, sourceLabel, modified, title, outPath }) => {
    try {
      const { entries, missing } = await resolveEntries(ids, { locale, sourceLabel, modified });
      if (entries.length === 0) return errorResult(`no usable pictures for: ${ids.join(", ")}`);
      const out = outPath ?? outName(entries, "pptx");
      await buildPptx(entries, out, { locale, sourceLabel, modified, title, creditPlacement });
      return fileResult(
        out,
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        {
          slides: entries.length,
          missing,
          creditPlacement,
          note:
            creditPlacement === "corner"
              ? "Compact license note is in each slide's bottom-right corner; full credits on the References slide."
              : "Credit is in each slide's caption legend and on the References slide.",
        }
      );
    } catch (e) {
      return errorResult(`build_pptx failed: ${(e as Error).message}`);
    }
  }
);

server.tool(
  "download_asset",
  "Download a picture asset to disk WITH the credit embedded in the file itself " +
    "(layer-3 attribution): PNG gets iTXt + XMP metadata, SVG gets an RDF <metadata> " +
    "block. Other formats are saved as-is. Returns the saved file path.",
  {
    id: z.string().describe("DOI URL or bare DOI."),
    format: z
      .enum(["png", "svg", "monotone_png", "monotone_svg", "detail_image1", "apng"])
      .default("png"),
    locale: localeSchema,
    sourceLabel: sourceLabelSchema,
    modified: z.boolean().default(false),
    outPath: z.string().optional().describe("Absolute output path; default is a temp dir."),
  },
  async ({ id, format, locale, sourceLabel, modified, outPath }) => {
    try {
      const p = await getPictureById(id);
      if (!p) return errorResult(`picture not found: ${id}`);
      const file = p[format as AssetFormat];
      if (!file || file === "-") return errorResult(`format "${format}" not available for ${id}`);

      const { buf, mime } = await fetchImageBuffer(assetUrl(file));
      const meta = attributionMeta(p, { locale, sourceLabel, modified });

      let out: Buffer | string = buf;
      let embedded = false;
      if (mime === "image/png") {
        out = embedPngAttribution(buf, meta);
        embedded = true;
      } else if (mime === "image/svg+xml" || file.endsWith(".svg")) {
        out = embedSvgAttribution(buf.toString("utf8"), meta);
        embedded = true;
      }

      const dest = outPath ?? join(OUT_DIR, file);
      await writeFile(dest, out as any);
      return fileResult(dest, mime, {
        format,
        embedded,
        embedded_fields: embedded
          ? ["Title", "Author", "Copyright", "Source", "License", "XMP (dc/xmpRights/cc)"]
          : [],
        citation: meta.credit,
        license: "CC-BY-4.0",
        note: embedded
          ? "Credit is written into the file metadata; still show the visible credit when publishing."
          : "This format cannot carry embedded metadata; you MUST show the visible credit.",
      });
    } catch (e) {
      return errorResult(`download_asset failed: ${(e as Error).message}`);
    }
  }
);

server.tool(
  "build_diagram",
  "Compose a flow schematic ('ポンチ絵') from gallery illustrations: nodes laid out " +
    "with a deterministic snake-grid auto-layout (no overlaps, arrows never diagonal), " +
    "connected by labeled arrows, with all image credits aggregated into a References " +
    "block. Each step may reference a Togo picture gallery illustration by DOI (fetched " +
    "with its mandatory CC-BY credit) OR an external image via image_path/image_url with " +
    "source:'bioart' (NIH BioArt Source, free to use — credit optional) or 'external', OR " +
    "be a labeled placeholder. Credits are kept source-correct: never CC-BY on a BioArt " +
    "image. Writes a .pptx and returns its path.",
  {
    title: z.string().describe("Diagram title."),
    subtitle: z.string().optional(),
    steps: z
      .array(
        z.object({
          label: z.string().describe("Node caption."),
          doi: z.string().optional().describe("Togo picture gallery DOI (fetched with its mandatory CC-BY credit)."),
          bioart_id: z.string().optional().describe('NIH BioArt id ("708", "BIOART-000708" or a /bioart/708 URL) — fetched automatically with the official NIAID citation.'),
          image_path: z.string().optional().describe("Local image file for any other source."),
          image_url: z.string().optional().describe("Remote image URL (for a non-Togo source)."),
          source: z
            .enum(["bioart", "external"])
            .optional()
            .describe('Credit source for image_path/image_url: "bioart" = NIH BioArt Source (free to use), "external" = user-supplied.'),
          title: z.string().optional().describe("Illustration title, for the external credit line."),
          credit: z.string().optional().describe("Explicit credit text overriding the generated one."),
          slot: z.string().optional().describe("Placeholder text when no image (default: the label)."),
        })
      )
      .min(2)
      .describe("Nodes in flow order. Mix Togo DOIs and external (e.g. BioArt) images freely."),
    edges: z
      .array(z.string())
      .optional()
      .describe("Arrow labels between consecutive steps (length = steps-1)."),
    locale: localeSchema,
    sourceLabel: sourceLabelSchema,
    modified: z.boolean().default(false),
    outPath: z.string().optional(),
  },
  async ({ title, subtitle, steps, edges, locale, sourceLabel, modified, outPath }) => {
    try {
      const opts = { locale, sourceLabel, modified };
      const resolved: DiagramStep[] = [];
      const missing: string[] = [];
      const citations: string[] = [];
      for (const st of steps) {
        // 1) Togo picture gallery (DOI): fetched + CC-BY credit embedded.
        if (st.doi) {
          const pic = await getPictureById(st.doi);
          if (pic && pic.png && pic.png !== "-") {
            const { buf, mime } = await fetchImageBuffer(assetUrl(pic.png));
            const meta = attributionMeta(pic, opts);
            const image = toEmbedded(mime === "image/png" ? embedPngAttribution(buf, meta) : buf, mime);
            const citation = buildCitation(pic, opts).text;
            resolved.push({ label: st.label, image, citation });
            citations.push(citation);
            continue;
          }
          missing.push(st.doi);
          resolved.push({ label: st.label, slot: st.slot ?? `[${st.label}]` });
          continue;
        }
        // 2) NIH BioArt by id: resolved automatically, official NIAID citation.
        if (st.bioart_id) {
          try {
            const asset = await fetchBioArt(st.bioart_id, st.title);
            const image = await fetchImageAsDataUri(asset.imageUrl);
            resolved.push({ label: st.label, image, citation: asset.citation });
            citations.push(asset.citation);
            continue;
          } catch {
            missing.push(st.bioart_id);
          }
        }
        // 3) Any other external image: source-aware credit, no CC-BY.
        if (st.image_path || st.image_url) {
          try {
            const image = st.image_path
              ? await loadImageFile(st.image_path)
              : await fetchImageAsDataUri(st.image_url as string);
            const credit = externalCredit({ source: st.source, title: st.title ?? st.label, credit: st.credit, locale }).text;
            resolved.push({ label: st.label, image, citation: credit });
            citations.push(credit);
            continue;
          } catch {
            missing.push(st.image_path ?? st.image_url ?? st.label);
          }
        }
        // 3) Placeholder.
        resolved.push({ label: st.label, slot: st.slot ?? `[${st.label}]` });
      }
      const first = steps.find((s) => s.doi)?.doi;
      const base = first ? bareDoi(first).replace(/[^\w]+/g, "_") : "diagram";
      const out = outPath ?? join(OUT_DIR, `${base}_diagram.pptx`);
      await buildDiagram({ title, subtitle, steps: resolved, edges }, out);
      return fileResult(
        out,
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        {
          title,
          nodes: steps.length,
          with_images: citations.length,
          placeholders: steps.length - citations.length,
          missing_doi: missing,
          note:
            "Arrow labels are plain text (no background); credits for all placed images are " +
            "in the References block. Placeholder nodes need an illustration DOI or stay labeled.",
        }
      );
    } catch (e) {
      return errorResult(`build_diagram failed: ${(e as Error).message}`);
    }
  }
);

server.tool(
  "annotate_image",
  "Annotate ONE illustration without altering it: speech-bubble callouts with leader " +
    "lines, ring markers, translucent highlights, and loupe close-ups. A close-up " +
    "re-inserts the same image bytes with a PowerPoint display-level crop (srcRect), so " +
    "the original asset is never re-encoded and the crop stays editable/undoable in " +
    "PowerPoint. Coordinates are fractions (0-1) of the image: at:[x,y] for a point, " +
    "rect:[x,y,w,h] for a region. Writes a .pptx and returns its path.",
  {
    doi: z.string().optional().describe("Togo picture gallery DOI (CC-BY credit added automatically)."),
    bioart_id: z.string().optional().describe('NIH BioArt id ("708", "BIOART-000708" or a /bioart/708 URL) — fetched with the official NIAID citation.'),
    image_url: z.string().optional().describe("Image URL for any other source."),
    image_path: z.string().optional().describe("Local image file for a non-Togo source."),
    source: z.enum(["bioart", "external"]).optional(),
    title: z.string().optional().describe("Slide title; also the title used in an external credit."),
    caption: z.string().optional(),
    credit: z.string().optional().describe("Explicit credit text for an external image."),
    annotations: z.array(annotationSchema).default([]),
    locale: localeSchema,
    sourceLabel: sourceLabelSchema,
    modified: z.boolean().default(false),
    outPath: z.string().optional(),
  },
  async ({ doi, bioart_id, image_url, image_path, source, title, caption, credit, annotations, locale, sourceLabel, modified, outPath }) => {
    try {
      const anns = (annotations ?? []) as Annotation[];
      // A close-up displays a cropped portion, so CC-BY "indicate changes" applies.
      const zoomed = hasCloseup(anns);
      let image: EmbeddedImage | undefined;
      let creditText = "";
      let base = "annotated";

      if (doi) {
        const pic = await getPictureById(doi);
        if (!pic || !pic.png || pic.png === "-") return errorResult(`picture not found or has no png: ${doi}`);
        const opts = { locale, sourceLabel, modified: modified || zoomed };
        const { buf, mime } = await fetchImageBuffer(assetUrl(pic.png));
        image = toEmbedded(mime === "image/png" ? embedPngAttribution(buf, attributionMeta(pic, opts)) : buf, mime);
        creditText = buildCitation(pic, opts).text;
        base = bareDoi(doi).replace(/[^\w]+/g, "_");
      } else if (bioart_id) {
        const asset = await fetchBioArt(bioart_id, title);
        image = await fetchImageAsDataUri(asset.imageUrl);
        creditText = asset.citation;
        base = asset.bioartId;
      } else if (image_path || image_url) {
        image = image_path ? await loadImageFile(image_path) : await fetchImageAsDataUri(image_url as string);
        creditText = externalCredit({ source, title, credit, locale }).text;
      } else {
        return errorResult("provide one of: doi, bioart_id, image_url, image_path");
      }

      const out = outPath ?? join(OUT_DIR, `${base}_annotated.pptx`);
      await buildAnnotatedImage({ title, caption, credit: creditText, image, annotations: anns }, out);
      return fileResult(
        out,
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        {
          annotations: anns.length,
          closeups: anns.filter((a) => a.type === "closeup").length,
          source_image_modified: false,
          credit: creditText,
          note:
            "Source image embedded unmodified; close-ups use a PowerPoint display-level crop." +
            (zoomed ? " Credit marked as modified because a cropped close-up is shown." : ""),
        }
      );
    } catch (e) {
      return errorResult(`annotate_image failed: ${(e as Error).message}`);
    }
  }
);

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout is reserved for the MCP protocol.
  console.error("togopic-mcp running on stdio");
}

// Only auto-start stdio when run directly (so http.ts can import createServer).
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main().catch((err) => {
    console.error("fatal:", err);
    process.exit(1);
  });
}
