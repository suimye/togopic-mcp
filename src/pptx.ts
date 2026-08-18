/**
 * PowerPoint builder: one slide per illustration, image centered with the
 * mandatory credit in a caption "legend" text box beneath it, plus a final
 * References slide. Uses pptxgenjs (pure JS, no headless browser).
 */
import pptxgenDefault from "pptxgenjs";
import { buildCitation, bareDoi, type CitationOptions } from "./citation.js";
import type { FigureEntry } from "./figure.js";

// pptxgenjs ships a default-exported class; normalize across CJS/ESM interop.
const PptxGenJS = pptxgenDefault as unknown as { new (): any };

export interface PptxOptions extends CitationOptions {
  title?: string;
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
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "W", width: 10, height: 5.63 });
  pptx.layout = "W";

  for (let i = 0; i < entries.length; i++) {
    const { picture: p, image } = entries[i];
    const c = buildCitation(p, opts);
    const slide = pptx.addSlide();
    const title = isJa ? p.name : p.name_en || p.name;
    const lab = isJa ? `図 ${i + 1}` : `Fig. ${i + 1}`;

    // Image area: centered upper block, aspect-preserved.
    const box = contain(image.natW ?? 1, image.natH ?? 1, 5.2, 3.4);
    slide.addImage({
      data: `${image.mime};base64,${image.base64}`,
      x: (10 - box.w) / 2,
      y: 0.35,
      w: box.w,
      h: box.h,
    });

    // Legend / caption with the mandatory credit.
    slide.addText(
      [
        { text: `${lab}. ${title}`, options: { bold: true, fontSize: 12 } },
        { text: "\n" + c.text, options: { fontSize: 9, color: "444444" } },
      ],
      { x: 0.5, y: 4.05, w: 9, h: 1.35, align: "center", valign: "top" }
    );
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
