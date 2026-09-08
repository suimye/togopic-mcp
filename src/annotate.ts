/**
 * Annotation layer for illustrations.
 *
 * Nothing here modifies the source image: every effect is drawn as PowerPoint
 * shapes/text on top of it, and "close-ups" re-insert the SAME image bytes with
 * a display-level crop (PowerPoint srcRect), which stays fully editable and
 * reversible in PowerPoint. The original asset is never re-encoded.
 *
 * All coordinates are fractions (0..1) of the image box, so annotations are
 * resolution-independent.
 */
import type { EmbeddedImage } from "./assets.js";

export interface Box { x: number; y: number; w: number; h: number }

export type Annotation =
  /** Speech bubble with a leader line pointing at a spot on the image. */
  | { type: "callout"; text: string; at: [number, number]; place?: "top" | "bottom" | "left" | "right"; style?: "leader" | "wedge" }
  /** Ring highlighting a spot, with an optional short label. */
  | { type: "marker"; at: [number, number]; label?: string; radius?: number }
  /** Translucent highlight over a region. */
  | { type: "highlight"; rect: [number, number, number, number]; shape?: "rect" | "ellipse"; label?: string }
  /** Loupe: outline a region and show it enlarged beside the image. */
  | { type: "closeup"; rect: [number, number, number, number]; scale?: number; label?: string; shape?: "rect" | "ellipse" };

const ACCENT = "C00000";
const INK = "1F3864";

export interface AnnotateCtx {
  pptx: any;
  slide: any;
  /** where the illustration is drawn on the slide (inches) */
  img: Box;
  image: EmbeddedImage;
  /** free column where close-up insets are stacked (inches) */
  insetArea: Box;
}

const toAbs = (img: Box, fx: number, fy: number) => ({ x: img.x + fx * img.w, y: img.y + fy * img.h });

export function hasCloseup(anns: Annotation[] = []): boolean {
  return anns.some((a) => a.type === "closeup");
}

export function drawAnnotations(ctx: AnnotateCtx, anns: Annotation[] = []): void {
  const { pptx: p, slide: s, img } = ctx;
  let insetY = ctx.insetArea.y; // stacking cursor for close-ups

  for (const a of anns) {
    if (a.type === "highlight") {
      const [fx, fy, fw, fh] = a.rect;
      const shape = a.shape === "ellipse" ? p.ShapeType.ellipse : p.ShapeType.rect;
      s.addShape(shape, {
        x: img.x + fx * img.w, y: img.y + fy * img.h, w: fw * img.w, h: fh * img.h,
        fill: { color: "FFD966", transparency: 78 },
        line: { color: ACCENT, width: 1.5 },
      });
      if (a.label) {
        s.addText(a.label, {
          x: img.x + fx * img.w, y: img.y + (fy + fh) * img.h + 0.03, w: fw * img.w, h: 0.24,
          align: "center", fontSize: 9, bold: true, color: ACCENT,
        });
      }
      continue;
    }

    if (a.type === "marker") {
      const c = toAbs(img, a.at[0], a.at[1]);
      const r = (a.radius ?? 0.06) * Math.min(img.w, img.h);
      s.addShape(p.ShapeType.ellipse, {
        x: c.x - r, y: c.y - r, w: r * 2, h: r * 2,
        fill: { type: "none" }, line: { color: ACCENT, width: 2 },
      });
      if (a.label) {
        s.addText(a.label, {
          x: c.x - 0.7, y: c.y + r + 0.02, w: 1.4, h: 0.24,
          align: "center", fontSize: 9, bold: true, color: ACCENT,
        });
      }
      continue;
    }

    if (a.type === "callout") {
      const anchor = toAbs(img, a.at[0], a.at[1]);
      const place = a.place ?? "right";
      const bw = 2.1, bh = 0.72, gap = 0.5;
      let bx = anchor.x + gap, by = anchor.y - bh / 2;
      if (place === "left") bx = anchor.x - gap - bw;
      if (place === "top") { bx = anchor.x - bw / 2; by = anchor.y - gap - bh; }
      if (place === "bottom") { bx = anchor.x - bw / 2; by = anchor.y + gap; }

      if (a.style === "wedge") {
        // native PowerPoint speech bubble (tail direction is the shape default)
        s.addShape(p.ShapeType.wedgeRoundRectCallout, {
          x: bx, y: by, w: bw, h: bh,
          fill: { color: "FFFFFF" }, line: { color: INK, width: 1.25 },
        });
      } else {
        // bubble + leader line: the pointer always lands exactly on the anchor
        const ex = place === "left" ? bx + bw : place === "right" ? bx : bx + bw / 2;
        const ey = place === "top" ? by + bh : place === "bottom" ? by : by + bh / 2;
        s.addShape(p.ShapeType.line, {
          x: ex, y: ey, w: anchor.x - ex, h: anchor.y - ey,
          line: { color: INK, width: 1.25 },
        });
        s.addShape(p.ShapeType.ellipse, {
          x: anchor.x - 0.045, y: anchor.y - 0.045, w: 0.09, h: 0.09,
          fill: { color: INK }, line: { color: INK, width: 1 },
        });
        s.addShape(p.ShapeType.roundRect, {
          x: bx, y: by, w: bw, h: bh, rectRadius: 0.12,
          fill: { color: "FFFFFF" }, line: { color: INK, width: 1.25 },
        });
      }
      s.addText(a.text, {
        x: bx + 0.08, y: by + 0.06, w: bw - 0.16, h: bh - 0.12,
        align: "center", valign: "middle", fontSize: 10, color: INK, fit: "shrink",
      });
      continue;
    }

    if (a.type === "closeup") {
      const [fx, fy, fw, fh] = a.rect;
      const region = { x: img.x + fx * img.w, y: img.y + fy * img.h, w: fw * img.w, h: fh * img.h };
      // 1) outline the source region on the untouched image
      const rshape = a.shape === "ellipse" ? p.ShapeType.ellipse : p.ShapeType.rect;
      s.addShape(rshape, {
        x: region.x, y: region.y, w: region.w, h: region.h,
        fill: { type: "none" }, line: { color: ACCENT, width: 2 },
      });
      // 2) inset sized to the region's aspect so nothing is stretched
      const natW = ctx.image.natW || 1, natH = ctx.image.natH || 1;
      const aspect = (fw * natW) / (fh * natH);
      let iw = ctx.insetArea.w;
      let ih = iw / aspect;
      const remaining = ctx.insetArea.y + ctx.insetArea.h - insetY;
      const maxH = Math.max(0.8, remaining - (a.label ? 0.3 : 0.1));
      if (ih > maxH) { ih = maxH; iw = ih * aspect; }
      const ix = ctx.insetArea.x + (ctx.insetArea.w - iw) / 2;
      const iy = insetY;
      // 3) same image bytes, display-level crop (srcRect) — original untouched.
      //    Scale the whole image up so the region fills the inset, then crop the
      //    window to the inset size: sizing.w/h is the FINAL placed size.
      const FW = iw / fw, FH = ih / fh;
      s.addImage({
        data: `${ctx.image.mime};base64,${ctx.image.base64}`,
        x: ix, y: iy, w: FW, h: FH,
        sizing: { type: "crop", x: fx * FW, y: fy * FH, w: iw, h: ih },
      });
      s.addShape(p.ShapeType.rect, {
        x: ix, y: iy, w: iw, h: ih,
        fill: { type: "none" }, line: { color: ACCENT, width: 1.75 },
      });
      // 4) connector lines region -> inset (loupe effect)
      s.addShape(p.ShapeType.line, { x: region.x + region.w, y: region.y, w: ix - (region.x + region.w), h: iy - region.y, line: { color: ACCENT, width: 1, dashType: "dash" } });
      s.addShape(p.ShapeType.line, { x: region.x + region.w, y: region.y + region.h, w: ix - (region.x + region.w), h: iy + ih - (region.y + region.h), line: { color: ACCENT, width: 1, dashType: "dash" } });
      if (a.label) {
        s.addText(a.label, { x: ix, y: iy + ih + 0.03, w: iw, h: 0.26, align: "center", fontSize: 9, bold: true, color: ACCENT });
      }
      insetY = iy + ih + (a.label ? 0.36 : 0.18);
      continue;
    }
  }
}

// ---- slide builder ----
import pptxgenDefault from "pptxgenjs";
const PptxGenJS = pptxgenDefault as unknown as { new (): any };

export interface AnnotatedSpec {
  title?: string;
  caption?: string;
  /** Credit line for the illustration (source-correct). */
  credit: string;
  image: EmbeddedImage;
  annotations: Annotation[];
}

/** One slide: the untouched illustration plus its annotation layer. */
export async function buildAnnotatedImage(spec: AnnotatedSpec, outPath: string): Promise<string> {
  const p = new PptxGenJS();
  p.defineLayout({ name: "W", width: 10, height: 5.63 });
  p.layout = "W";
  const s = p.addSlide();

  if (spec.title) {
    s.addText(spec.title, { x: 0.4, y: 0.22, w: 9.2, h: 0.5, align: "center", bold: true, fontSize: 20, color: INK });
  }

  const withInsets = hasCloseup(spec.annotations);
  const areaY = spec.title ? 1.0 : 0.5;
  const areaH = 3.6;
  const areaX = 0.5;
  const areaW = withInsets ? 5.2 : 8.2;

  // contain the illustration in its area (no stretching, no re-encoding)
  const ar = (spec.image.natW || 1) / (spec.image.natH || 1);
  let w = areaW, h = w / ar;
  if (h > areaH) { h = areaH; w = h * ar; }
  const img: Box = { x: areaX + (areaW - w) / 2, y: areaY + (areaH - h) / 2, w, h };

  // the original image goes down first; every annotation layers on top of it
  s.addImage({ data: `${spec.image.mime};base64,${spec.image.base64}`, x: img.x, y: img.y, w: img.w, h: img.h });

  drawAnnotations(
    { pptx: p, slide: s, img, image: spec.image, insetArea: { x: 6.1, y: areaY, w: 3.3, h: areaH } },
    spec.annotations
  );

  if (spec.caption) {
    s.addText(spec.caption, { x: 0.5, y: 4.72, w: 9, h: 0.32, align: "center", fontSize: 11, color: "333333", fit: "shrink" });
  }
  s.addText(spec.credit, { x: 0.5, y: 5.08, w: 9, h: 0.38, align: "center", fontSize: 7.5, color: "555555" });

  await p.writeFile({ fileName: outPath });
  return outPath;
}
