/**
 * Illustration sources and their credit rules. Different sources have different
 * licenses, so credit must be source-aware — never stamp a Togo CC-BY credit on
 * a public-domain BioArt image, and never force a required credit on content
 * whose license does not require one.
 *
 * - togotv: Togo picture gallery — CC-BY-4.0, © DBCLS TogoTV. Credit REQUIRED.
 *           Has a public API + DOI, so it is fetched and credited automatically.
 * - bioart: NIH BioArt Source (NIH/NIAID) — free for any use (public domain).
 *           Credit is a COURTESY, not required. No public API/DOI: the user
 *           supplies a downloaded image file.
 * - external: any other image the user supplies, with a credit they provide.
 */
export type SourceId = "togotv" | "bioart" | "external";

export interface ExternalCreditInput {
  source?: SourceId;
  /** Human title of the illustration (optional). */
  title?: string;
  /** Explicit credit text; overrides the generated one. */
  credit?: string;
  locale?: "ja" | "en";
}

export interface SourceCredit {
  /** Credit line to display / put in a References block. */
  text: string;
  /** Whether the license requires the credit to be shown. */
  required: boolean;
  /** Short license label. */
  license: string;
  /** Source/license URL. */
  url: string;
}

const BIOART_URL = "https://bioart.niaid.nih.gov";

/** Build a credit for a non-Togo (externally supplied) image. */
export function externalCredit(opts: ExternalCreditInput = {}): SourceCredit {
  const isJa = (opts.locale ?? "en") === "ja";
  const title = (opts.title ?? "").trim();

  if (opts.credit) {
    return { text: opts.credit, required: false, license: "custom", url: "" };
  }

  if (opts.source === "bioart") {
    const t = title ? (isJa ? `「${title}」の画像は ` : `The image of "${title}" is `) : isJa ? "画像は " : "Image ";
    // BioArt is free/public-domain so credit is not legally required, but by
    // policy we ALWAYS write the NIH credit — hence required: true here.
    return {
      text: isJa
        ? `${t}NIH BioArt Source (NIH/NIAID) より。${BIOART_URL}`
        : `${t}from NIH BioArt Source (NIH/NIAID). ${BIOART_URL}`,
      required: true,
      license: "NIH BioArt Source",
      url: BIOART_URL,
    };
  }

  // generic external image with no known license
  return {
    text: title || (isJa ? "外部提供画像" : "external image"),
    required: false,
    license: "unspecified",
    url: "",
  };
}
