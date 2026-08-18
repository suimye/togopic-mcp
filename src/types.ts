/**
 * A single Togo picture gallery entry as returned by togotv-api.
 * Only fields we actually rely on are typed; the API may return more.
 */
export interface Picture {
  /** DOI URL, e.g. "https://doi.org/10.7875/togopic.2026.036". Primary id. */
  id: string;
  /** Japanese title, e.g. "下眼瞼コロボーマ". */
  name: string;
  /** English title, e.g. "Lower eyelid coloboma". */
  name_en: string;
  /** Illustrator, plain string (no HTML), e.g. "erico". */
  author_str?: string;
  /** Illustrator, may contain HTML anchors. */
  author?: string;
  /** Editor, may contain HTML anchors, e.g. "JSPG & DBCLS". */
  editor?: string;
  /** Publisher, e.g. "DBCLS". */
  publisher?: string;
  /** License URL, expected to be CC BY 4.0. */
  license?: string;
  /** ISO date the item was uploaded, e.g. "2026-07-17". */
  uploadDate?: string;
  /** Scientific name. */
  scientific_name?: string;
  /** NCBI taxonomy id. */
  tax_id?: string;
  taxon1?: string;
  taxon2?: string;
  other_tags?: string;
  other_tags_comma?: string;
  Description_small?: string;
  Description_large?: string;
  TogoTV_Image_ID?: number;
  togopic_id?: number;

  // Asset file names (served under IMAGE_BASE). "-" or undefined means absent.
  png?: string;
  svg?: string;
  ai?: string;
  apng?: string;
  rotation?: string;
  obj_mtl_zip?: string;
  monotone_png?: string;
  monotone_svg?: string;
  detail_image1?: string;
}

export interface SearchResponse {
  data: Picture[];
  total?: number;
  numfound?: number;
  last_page?: number;
  start?: number;
}

/** Downloadable asset formats keyed to Picture fields. */
export type AssetFormat =
  | "png"
  | "svg"
  | "ai"
  | "apng"
  | "rotation"
  | "obj_mtl_zip"
  | "monotone_png"
  | "monotone_svg"
  | "detail_image1";
