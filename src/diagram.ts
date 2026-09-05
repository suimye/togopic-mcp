/**
 * build_diagram renderer: a flow "ポンチ絵" (schematic) that combines gallery
 * illustrations into one slide with arrows + labels, using a deterministic
 * snake-grid auto-layout so nothing overlaps and arrows never go diagonal.
 * All credits are aggregated into a References block at the bottom.
 */
import pptxgenDefault from "pptxgenjs";
import type { EmbeddedImage } from "./assets.js";

const PptxGenJS = pptxgenDefault as unknown as { new (): any };

export interface DiagramStep {
  label: string;
  /** Placeholder text when no image (e.g. "[togopic: reads]"). */
  slot?: string;
  image?: EmbeddedImage;
  /** Full credit line (shown in the References block) when image is present. */
  citation?: string;
}

export interface DiagramSpec {
  title: string;
  subtitle?: string;
  steps: DiagramStep[];
  /** Labels between consecutive steps; length steps.length-1 (missing = blank). */
  edges?: string[];
}

const W = 10, H = 5.63;
const COL = ["DDEBF7", "E2EFDA", "FCE4D6", "FFF2CC", "EAD1DC", "D9E1F2"];
const EDGE = "2E74B5";

function pickCols(n: number): number {
  if (n <= 3) return n;
  if (n === 4) return 2;
  return 3;
}

interface Rect { x: number; y: number; w: number; h: number; }

/** Snake-grid node rectangles: rows alternate direction so wraps stay vertical. */
function layout(n: number, hasRefs: boolean): Rect[] {
  const AREA = { x0: 0.5, x1: 9.5, yTop: 1.35, yBot: hasRefs ? 4.25 : 5.0 };
  const C = pickCols(n);
  const rows = Math.ceil(n / C);
  const contentW = AREA.x1 - AREA.x0;
  const contentH = AREA.yBot - AREA.yTop;
  const gapX = C > 1 ? Math.min(1.9, contentW * 0.16) : 0;
  const nodeW = (contentW - gapX * (C - 1)) / C;
  const rowGap = rows > 1 ? Math.min(0.9, contentH * 0.14) : 0;
  const nodeH = Math.min(2.2, (contentH - rowGap * (rows - 1)) / rows);
  const rects: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / C);
    const cInRow = i % C;
    const col = r % 2 === 0 ? cInRow : C - 1 - cInRow;
    rects.push({ x: AREA.x0 + col * (nodeW + gapX), y: AREA.yTop + r * (nodeH + rowGap), w: nodeW, h: nodeH });
  }
  return rects;
}

function contain(nw: number, nh: number, mw: number, mh: number) {
  const r = Math.min(mw / nw, mh / nh);
  return { w: nw * r, h: nh * r };
}

export async function buildDiagram(spec: DiagramSpec, outPath: string): Promise<string> {
  const steps = spec.steps;
  const cites = steps.map((s) => s.citation).filter(Boolean) as string[];
  const rects = layout(steps.length, cites.length > 0);
  const p = new PptxGenJS();
  p.defineLayout({ name: "W", width: W, height: H });
  p.layout = "W";
  const s = p.addSlide();

  s.addText(spec.title, { x: 0.4, y: 0.22, w: 9.2, h: 0.55, align: "center", bold: true, fontSize: 22, color: "1F3864" });
  if (spec.subtitle) s.addText(spec.subtitle, { x: 0.4, y: 0.8, w: 9.2, h: 0.35, align: "center", fontSize: 11, color: "666666" });

  // nodes
  steps.forEach((st, i) => {
    const rc = rects[i], fill = COL[i % COL.length];
    s.addShape(p.ShapeType.roundRect, { x: rc.x, y: rc.y, w: rc.w, h: rc.h, fill: { color: fill }, line: { color: "8FAADC", width: 1 }, rectRadius: 0.07 });
    s.addText(st.label, { x: rc.x + 0.05, y: rc.y + 0.06, w: rc.w - 0.1, h: 0.42, align: "center", valign: "middle", bold: true, fontSize: 13, color: "1F3864", fit: "shrink" });
    const pad = 0.14, iy = rc.y + 0.54, iw = rc.w - pad * 2, ih = rc.y + rc.h - iy - pad;
    if (st.image) {
      const box = contain(st.image.natW || 1, st.image.natH || 1, iw, ih);
      s.addImage({ data: `${st.image.mime};base64,${st.image.base64}`, x: rc.x + (rc.w - box.w) / 2, y: iy + (ih - box.h) / 2, w: box.w, h: box.h });
    } else {
      s.addShape(p.ShapeType.rect, { x: rc.x + pad, y: iy, w: iw, h: ih, fill: { color: "FFFFFF" }, line: { color: "BBBBBB", width: 1, dashType: "dash" } });
      if (st.slot) s.addText(st.slot, { x: rc.x + pad, y: iy, w: iw, h: ih, align: "center", valign: "middle", fontSize: 8, italic: true, color: "999999", fit: "shrink" });
    }
  });

  // arrows (H within a row, V on wrap) with plain-text labels above/beside the line
  const inset = 0.04;
  for (let i = 0; i < steps.length - 1; i++) {
    const a = rects[i], b = rects[i + 1], label = spec.edges?.[i] || "";
    if (Math.abs(a.y - b.y) < 0.01) {
      const ay = a.y + a.h / 2;
      const [x1, x2] = b.x > a.x ? [a.x + a.w + inset, b.x - inset] : [a.x - inset, b.x + b.w + inset];
      s.addShape(p.ShapeType.line, { x: x1, y: ay, w: x2 - x1, h: 0, line: { color: EDGE, width: 2.25, endArrowType: "triangle" } });
      if (label) s.addText(label, { x: (x1 + x2) / 2 - 0.7, y: ay - 0.42, w: 1.4, h: 0.3, align: "center", valign: "middle", fontSize: 11, bold: true, color: EDGE, fit: "shrink" });
    } else {
      const cx = a.x + a.w / 2, y1 = a.y + a.h + inset, y2 = b.y - inset;
      s.addShape(p.ShapeType.line, { x: cx, y: y1, w: 0, h: y2 - y1, line: { color: EDGE, width: 2.25, endArrowType: "triangle" } });
      if (label) s.addText(label, { x: cx + 0.08, y: (y1 + y2) / 2 - 0.15, w: 1.2, h: 0.3, align: "left", valign: "middle", fontSize: 11, bold: true, color: EDGE, fit: "shrink" });
    }
  }

  if (cites.length) {
    s.addText(cites.map((c, i) => `図${i + 1}: ${c}`).join("\n"),
      { x: 0.4, y: 4.35, w: 9.2, h: 0.95, fontSize: 7, color: "555555", lineSpacingMultiple: 1.05, valign: "top" });
  }

  await p.writeFile({ fileName: outPath });
  return outPath;
}
