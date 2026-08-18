/**
 * Citation generation for Togo picture gallery images.
 *
 * Based on the official DBCLS TogoTV usage terms:
 *
 *   TogoTV のコンテンツは CC BY 4.0 のもとでライセンスされています。各コンテンツの
 *   著作権は「DBCLS TogoTV」が保持しますが、①適切なクレジット(出典)を表示し、
 *   ②ライセンスへのリンクを提供し、③変更があったらその旨を示すこと、を条件に
 *   自由に利用できます。
 *
 *   例: The image of XX is from TogoTV
 *       (© 2016 DBCLS TogoTV, CC-BY-4.0 https://creativecommons.org/licenses/by/4.0/deed.ja)
 *
 * The copyright holder for the credit line is the corporate "DBCLS TogoTV",
 * NOT the individual illustrator. The illustrator (author_str) is surfaced
 * separately as optional extra credit, never as a replacement.
 */
import type { Picture } from "./types.js";

export const LICENSE_CODE = "CC-BY-4.0";
export const LICENSE_URL_JA = "https://creativecommons.org/licenses/by/4.0/deed.ja";
export const LICENSE_URL_EN = "https://creativecommons.org/licenses/by/4.0/deed.en";
export const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
export const COPYRIGHT_HOLDER = "DBCLS TogoTV";

/** Default source label; override per-call via opts.sourceLabel or env. */
export const DEFAULT_SOURCE_LABEL = process.env.TOGOPIC_SOURCE_LABEL ?? "TogoTV";

export interface CitationOptions {
  /** "ja" | "en" — controls wording and the license deed link. Default "en". */
  locale?: "ja" | "en";
  /** Set true if the image was modified; CC-BY requires indicating changes. */
  modified?: boolean;
  /** Source label shown in the credit. Default "TogoTV" (matches official example). */
  sourceLabel?: string;
}

export interface CitationBundle {
  /** Plain-text credit line, ready to paste into a slide / legend. */
  text: string;
  /** HTML credit line with hyperlinks (license + DOI). */
  html: string;
  /** BibTeX entry. */
  bibtex: string;
  /** The DOI URL (stable identifier). */
  doi: string;
}

/** Strip HTML tags/entities from an API field (author/editor may carry anchors). */
export function plain(s: string | undefined): string {
  if (!s) return "";
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** Bare DOI ("10.7875/togopic.2026.036") from a DOI URL or bare string. */
export function bareDoi(id: string | undefined): string {
  if (!id) return "";
  return id.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
}

/** Copyright year: prefer the year embedded in the togopic DOI, then uploadDate. */
export function citationYear(p: Picture): string {
  const fromDoi = bareDoi(p.id).match(/togopic\.(\d{4})\./i);
  if (fromDoi) return fromDoi[1];
  if (p.uploadDate) {
    const y = p.uploadDate.slice(0, 4);
    if (/^\d{4}$/.test(y)) return y;
  }
  return "";
}

function bibtexKey(p: Picture): string {
  const doi = bareDoi(p.id).match(/togopic\.(\d{4})\.(\d+)/i);
  if (doi) return `togopic_${doi[1]}_${doi[2]}`;
  return `togopic_${p.togopic_id ?? p.TogoTV_Image_ID ?? "item"}`;
}

/**
 * Build the full citation bundle (text / html / bibtex) for one picture,
 * following the official DBCLS TogoTV credit format.
 */
export function buildCitation(p: Picture, opts: CitationOptions = {}): CitationBundle {
  const locale = opts.locale ?? "en";
  const source = opts.sourceLabel ?? DEFAULT_SOURCE_LABEL;
  const year = citationYear(p);
  const doiUrl = p.id?.startsWith("http") ? p.id : `https://doi.org/${bareDoi(p.id)}`;
  const licenseDeed = locale === "ja" ? LICENSE_URL_JA : LICENSE_URL_EN;
  const title = locale === "ja" ? p.name : p.name_en || p.name;
  const copyright = `© ${year} ${COPYRIGHT_HOLDER}`.replace("©  ", "© ");
  const modifiedNote = opts.modified
    ? locale === "ja"
      ? "（改変あり）"
      : ", modified"
    : "";

  // Plain text — mirrors the official example wording.
  const text =
    locale === "ja"
      ? `「${title}」の画像は ${source} より引用${modifiedNote} ` +
        `(${copyright}, ${LICENSE_CODE} ${licenseDeed})。出典: ${doiUrl}`
      : `The image of "${title}" is from ${source}${modifiedNote} ` +
        `(${copyright}, ${LICENSE_CODE} ${licenseDeed}). Source: ${doiUrl}`;

  // HTML — license and DOI as hyperlinks.
  const html =
    locale === "ja"
      ? `「${escapeHtml(title)}」の画像は ${escapeHtml(source)} より引用${modifiedNote} ` +
        `(${copyright}, <a href="${licenseDeed}">${LICENSE_CODE}</a>)。` +
        `出典: <a href="${doiUrl}">${escapeHtml(doiUrl)}</a>`
      : `The image of &quot;${escapeHtml(title)}&quot; is from ${escapeHtml(source)}${modifiedNote} ` +
        `(${copyright}, <a href="${licenseDeed}">${LICENSE_CODE}</a>). ` +
        `Source: <a href="${doiUrl}">${escapeHtml(doiUrl)}</a>`;

  const illustrator = plain(p.author_str || p.author);
  const bibtex = [
    `@misc{${bibtexKey(p)},`,
    `  title     = {${p.name_en || p.name}${p.name_en && p.name ? ` (${p.name})` : ""}},`,
    `  author    = {{${COPYRIGHT_HOLDER}}},`,
    year ? `  year      = {${year}},` : null,
    `  howpublished = {${source}, Togo picture gallery},`,
    bareDoi(p.id) ? `  doi       = {${bareDoi(p.id)}},` : null,
    `  url       = {${doiUrl}},`,
    `  note      = {${LICENSE_CODE}, ${LICENSE_URL}${illustrator ? `; illustration by ${illustrator}` : ""}${opts.modified ? "; modified" : ""}},`,
    `}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { text, html, bibtex, doi: doiUrl };
}

/** Compact credit for a slide corner: "© YYYY DBCLS TogoTV · CC-BY-4.0". */
export function shortCredit(p: Picture, opts: CitationOptions = {}): string {
  const year = citationYear(p);
  return `© ${year} ${COPYRIGHT_HOLDER} · ${LICENSE_CODE}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Assemble a Reference.md body for a set of pictures. This is what callers
 * embed into a paper / slide deck / PDF to satisfy the attribution terms.
 */
export function buildReferenceMarkdown(
  pictures: Picture[],
  opts: CitationOptions = {}
): string {
  const locale = opts.locale ?? "en";
  const intro =
    locale === "ja"
      ? `本資料は下記の Togo picture gallery のイラストを使用しています。` +
        `各コンテンツの著作権は「${COPYRIGHT_HOLDER}」が保持し、${LICENSE_CODE} の` +
        `もとで利用しています。`
      : `This material uses the following illustrations from the Togo picture gallery. ` +
        `Copyright is held by "${COPYRIGHT_HOLDER}" and they are used under ${LICENSE_CODE}.`;

  const items = pictures
    .map((p, i) => `${i + 1}. ${buildCitation(p, opts).text}`)
    .join("\n");

  const heading =
    locale === "ja" ? "# 出典 — Togo picture gallery" : "# References — Togo picture gallery";

  return `${heading}\n\n${intro}\n\n${items}\n`;
}
