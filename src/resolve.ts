/**
 * Concept -> illustration resolution, including the "there is no such picture"
 * case. Some concepts simply have no Togo illustration (e.g. "contig",
 * "scaffold", "read"), so instead of silently producing an empty box the server
 * says so, shows what it tried, offers any near matches, and points at the
 * remaining options.
 */
import { searchPictures } from "./api.js";
import { buildCitation, type CitationOptions } from "./citation.js";
import { assetUrl } from "./api.js";
import type { Picture } from "./types.js";

export interface Candidate {
  id: string;
  name: string;
  name_en: string;
  thumbnail_url?: string;
  citation: string;
}

export interface ConceptResult {
  query: string;
  found: boolean;
  /** The term that actually produced hits (may differ from `query`). */
  matched_term?: string;
  tried_terms: string[];
  candidates: Candidate[];
  advice: string;
}

const BIOART = "https://bioart.niaid.nih.gov";

function toCandidate(p: Picture, opts: CitationOptions): Candidate {
  return {
    id: p.id,
    name: p.name,
    name_en: p.name_en,
    thumbnail_url: p.png && p.png !== "-" ? assetUrl(p.png) : undefined,
    citation: buildCitation(p, opts).text,
  };
}

/** Simple, honest fallbacks: the exact term, then its individual words. */
function fallbackTerms(query: string): string[] {
  const q = query.trim();
  const terms = [q];
  const words = q.split(/[\s,、・/]+/).filter((w) => w.length >= 2);
  if (words.length > 1) {
    // longest words first — they are usually the more specific concept
    for (const w of [...words].sort((a, b) => b.length - a.length)) {
      if (!terms.includes(w)) terms.push(w);
    }
  }
  return terms;
}

export async function findIllustration(
  query: string,
  opts: { locale?: "ja" | "en"; sourceLabel?: string; limit?: number } = {}
): Promise<ConceptResult> {
  const limit = opts.limit ?? 5;
  const cOpts = { locale: opts.locale, sourceLabel: opts.sourceLabel };
  const tried: string[] = [];

  for (const term of fallbackTerms(query)) {
    tried.push(term);
    let hits: Picture[] = [];
    try {
      const res = await searchPictures({ text: term, rows: limit });
      hits = res.data ?? [];
    } catch {
      hits = [];
    }
    if (hits.length) {
      const exact = term === query.trim();
      return {
        query,
        found: true,
        matched_term: term,
        tried_terms: tried,
        candidates: hits.map((p) => toCandidate(p, cOpts)),
        advice: exact
          ? "Pick a candidate and pass its `id` as the step `doi`."
          : `No hit for "${query}"; these come from the broader term "${term}" — check they actually fit before using.`,
      };
    }
  }

  return {
    query,
    found: false,
    tried_terms: tried,
    candidates: [],
    advice:
      `The Togo picture gallery has no illustration for "${query}". Options, in order: ` +
      `(1) retry with a broader or related concept (e.g. a parent term, or the English/Japanese counterpart); ` +
      `(2) use NIH BioArt Source — search ${BIOART} and pass the asset's id as \`bioart_id\` ` +
      `(public domain, cited automatically); ` +
      `(3) keep it as a labeled placeholder in build_diagram, which renders a dashed box with the label. ` +
      `Do NOT substitute an unrelated illustration just to fill the slot.`,
  };
}
