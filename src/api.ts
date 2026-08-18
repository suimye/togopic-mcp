/**
 * Thin, read-only client for the public togotv-api.
 * No credentials — the picture metadata (authored in a Google Spreadsheet and
 * indexed into Elastic Search) is served openly from these endpoints.
 */
import type { Picture, SearchResponse } from "./types.js";

export const API_BASE = process.env.TOGOTV_API_BASE ?? "https://togotv-api.dbcls.jp/api";
export const IMAGE_BASE =
  process.env.TOGOPIC_IMAGE_BASE ?? "https://dbarchive.biosciencedbc.jp/data/togo-pic/image";

const DEFAULT_TIMEOUT_MS = 15_000;

async function getJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "togopic-mcp" },
    });
    if (!res.ok) {
      throw new Error(`togotv-api ${res.status} ${res.statusText} for ${url}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const PICTURES = "target=pictures";

/** Full-text search over pictures. */
export async function searchPictures(params: {
  text?: string;
  tag?: string;
  from?: number;
  rows?: number;
}): Promise<SearchResponse> {
  const from = params.from ?? 0;
  const rows = Math.min(params.rows ?? 20, 100);
  const qs = new URLSearchParams();
  qs.set("target", "pictures");
  if (params.text) qs.set("text", params.text);
  if (params.tag) qs.set("other_tags", params.tag);
  qs.set("from", String(from));
  qs.set("rows", String(rows));
  return getJson<SearchResponse>(`${API_BASE}/search?${qs.toString()}`);
}

/** Newest-first listing of pictures. */
export async function listPictures(params: {
  from?: number;
  rows?: number;
}): Promise<SearchResponse> {
  const from = params.from ?? 0;
  const rows = Math.min(params.rows ?? 40, 100);
  return getJson<SearchResponse>(
    `${API_BASE}/entries?${PICTURES}&from=${from}&rows=${rows}`
  );
}

/** Fetch a single picture by DOI id (URL or bare DOI). */
export async function getPictureById(id: string): Promise<Picture | null> {
  const full = id.startsWith("http") ? id : `https://doi.org/${id.replace(/^\/+/, "")}`;
  const res = await getJson<SearchResponse>(
    `${API_BASE}/search?${PICTURES}&id=${encodeURIComponent(full)}`
  );
  return res.data?.[0] ?? null;
}

/** Facet values for a filter key (e.g. "other_tags", "taxon1"). */
export async function getFacets(key: string): Promise<unknown> {
  return getJson<unknown>(`${API_BASE}/facets/${encodeURIComponent(key)}?${PICTURES}`);
}

/** Absolute URL for a stored asset file name. */
export function assetUrl(filename: string): string {
  return `${IMAGE_BASE}/${filename}`;
}
