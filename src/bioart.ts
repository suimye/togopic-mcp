/**
 * NIH BioArt Source (NIAID) — fetch an asset by its BIOART id.
 *
 * BioArt has no documented public API, but each asset has a stable id and a
 * server-rendered detail page (`/bioart/{id}`) plus a public image endpoint
 * (`/api/bioarts/{id}/files/{fileId}`). That is enough to resolve an asset from
 * its id alone, so users only need to give the id instead of downloading files
 * by hand. Search still requires the site UI (it is client-rendered).
 *
 * Credit uses NIAID's own citation format shown on the asset page.
 */
const BASE = "https://bioart.niaid.nih.gov";

export interface BioArtAsset {
  id: string;
  bioartId: string;
  title: string;
  license: string;
  pageUrl: string;
  imageUrl: string;
  date?: string;
  /** Official NIAID citation line. */
  citation: string;
}

/** "ConicalSampleTube0001.png" -> "Conical Sample Tube" */
function titleFromFilename(name: string): string {
  const stem = name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_].*$/, "").replace(/\d+$/, "");
  return stem.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
}

/** Accepts "708", "BIOART-000708", or a /bioart/708 URL. */
export function parseBioArtId(input: string): string | null {
  const s = input.trim();
  const m =
    s.match(/bioart\/(\d+)/i) ||
    s.match(/BIOART-0*(\d+)/i) ||
    s.match(/^(\d+)$/);
  return m ? String(Number(m[1])) : null;
}

export async function fetchBioArt(input: string, titleOverride?: string): Promise<BioArtAsset> {
  const id = parseBioArtId(input);
  if (!id) throw new Error(`not a BioArt id/url: ${input}`);
  const pageUrl = `${BASE}/bioart/${id}`;
  const res = await fetch(pageUrl, { headers: { "user-agent": "togopic-mcp" } });
  if (!res.ok) throw new Error(`BioArt page ${res.status} for ${pageUrl}`);
  const html = await res.text();

  const fileMatch = html.match(new RegExp(`/api/bioarts/${id}/files/(\\d+)`));
  if (!fileMatch) throw new Error(`no image file found on ${pageUrl}`);
  const imageUrl = `${BASE}/api/bioarts/${id}/files/${fileMatch[1]}`;

  const bioartId = (html.match(/BIOART-\d{6}/) || [`BIOART-${id.padStart(6, "0")}`])[0];
  const license = /Public Domain/i.test(html)
    ? "Public Domain"
    : (html.match(/CC[- ]BY[^"<,]{0,12}/i) || ["see asset page"])[0];
  const fname = html.match(/\\"name\\":\\"([A-Za-z0-9_.-]+\.(?:png|svg|ai|eps))\\"/);
  const title = titleOverride || (fname ? titleFromFilename(fname[1]) : bioartId);
  const date = (html.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/) || [])[0];

  const citation =
    `NIAID Visual & Medical Arts.${date ? ` (${date}).` : ""} ${title}. ` +
    `NIAID NIH BIOART Source. bioart.niaid.nih.gov/bioart/${id}` +
    (license ? ` (${license})` : "");

  return { id, bioartId, title, license, pageUrl, imageUrl, date, citation };
}
