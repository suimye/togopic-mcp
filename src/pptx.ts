/**
 * PowerPoint builder: one slide per illustration, image centered with the
 * mandatory credit in a caption "legend" text box beneath it, plus a final
 * References slide. Uses pptxgenjs (pure JS, no headless browser).
 */
import pptxgenDefault from "pptxgenjs";
import { buildCitation, shortCredit, bareDoi, type CitationOptions } from "./citation.js";
import type { FigureEntry } from "./figure.js";

// pptxgenjs ships a default-exported class; normalize across CJS/ESM interop.
const PptxGenJS = pptxgenDefault as unknown as { new (): any };

export interface PptxOptions extends CitationOptions {
  title?: string;
  /** Where the per-slide credit goes. "corner" = small, bottom-right (default);
   *  "caption" = full legend centered beneath the image. */
  creditPlacement?: "corner" | "caption";
}

/** Fit (w,h) inside (maxW,maxH) preserving aspect; returns inches. */
function contain(natW: number, natH: number, maxW: number, maxH: number) {
  const r = Math.min(maxW / natW, maxH / natH);
  return { w: natW * r, h: natH * r };
}

export async function buildPptx(
  entries: FigureEntry[],
  outPath: string,
  opts: PptxOptions = {}
): Promise<string> {
  const isJa = (opts.locale ?? "en") === "ja";
  const placement = opts.creditPlacement ?? "corner";
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "W", width: 10, height: 5.63 });
  pptx.layout = "W";

  for (let i = 0; i < entries.length; i++) {
    const { picture: p, image } = entries[i];
    const c = buildCitation(p, opts);
    const slide = pptx.addSlide();
    const title = isJa ? p.name : p.name_en || p.name;
    const lab = isJa ? `図 ${i + 1}` : `Fig. ${i + 1}`;

    // Slide title (top).
    slide.addText(`${lab}. ${title}`, {
      x: 0.5, y: 0.25, w: 9, h: 0.6, align: "center", bold: true, fontSize: 20,
    });

    if (placement === "caption") {
      const box = contain(image.natW ?? 1, image.natH ?? 1, 5.2, 3.1);
      slide.addImage({
        data: `${image.mime};base64,${image.base64}`,
        x: (10 - box.w) / 2, y: 0.95, w: box.w, h: box.h,
      });
      slide.addText(c.text, {
        x: 0.5, y: 4.2, w: 9, h: 1.2, align: "center", valign: "top",
        fontSize: 9, color: "444444",
      });
    } else {
      // "corner": larger image, small license note bottom-right.
      const box = contain(image.natW ?? 1, image.natH ?? 1, 6.4, 3.9);
      slide.addImage({
        data: `${image.mime};base64,${image.base64}`,
        x: (10 - box.w) / 2, y: 0.95, w: box.w, h: box.h,
      });
      slide.addText(
        [
          { text: shortCredit(p, opts), options: { breakLine: true } },
          { text: c.doi, options: { fontSize: 7 } },
        ],
        {
          x: 4.9, y: 4.95, w: 4.85, h: 0.55, align: "right", valign: "bottom",
          fontSize: 7.5, color: "888888",
        }
      );
    }
  }

  // References slide.
  const seen = new Set<string>();
  const uniq = entries.filter((e) => {
    const k = bareDoi(e.picture.id);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const refSlide = pptx.addSlide();
  refSlide.addText(isJa ? "引用文献 / Acknowledgements" : "References / Acknowledgements", {
    x: 0.5, y: 0.3, w: 9, h: 0.5, bold: true, fontSize: 18,
  });
  refSlide.addText(
    uniq.map((e, i) => ({
      text: `[${i + 1}] ${buildCitation(e.picture, opts).text}`,
      options: { fontSize: 10, breakLine: true, paraSpaceAfter: 8 },
    })),
    { x: 0.5, y: 0.9, w: 9, h: 4.4, valign: "top" }
  );

  await pptx.writeFile({ fileName: outPath });
  return outPath;
}
