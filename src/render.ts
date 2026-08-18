/** Render HTML to PDF using a locally installed Chrome/Chromium (best-effort). */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean) as string[];

export function findChrome(): string | null {
  return CHROME_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

/** Optional puppeteer fallback (only if the user installed it). Dynamic import
 *  via a non-literal specifier so tsc doesn't require it at build time. */
async function loadPuppeteer(): Promise<any | null> {
  try {
    const name = "puppeteer";
    const mod: any = await import(name);
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

/** Render via puppeteer's bundled Chromium. Throws with guidance if unavailable. */
async function htmlToPdfViaPuppeteer(html: string, outPath: string): Promise<string> {
  const puppeteer = await loadPuppeteer();
  if (!puppeteer) {
    throw new Error(
      "No Chrome/Chromium found and puppeteer is not installed. Either install it " +
        "(`npm install puppeteer`, downloads a bundled Chromium), set CHROME_PATH to a " +
        "Chrome binary, or request format:'html' and print the returned HTML yourself."
    );
  }
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({ path: outPath, printBackground: true, preferCSSPageSize: true });
    return outPath;
  } finally {
    await browser.close();
  }
}

/** Write `html` to a temp file and print it to `outPath` as PDF.
 *  Prefers a locally installed Chrome; falls back to puppeteer if none is found. */
export async function htmlToPdf(html: string, outPath: string): Promise<string> {
  const chrome = findChrome();
  if (!chrome) {
    return htmlToPdfViaPuppeteer(html, outPath);
  }
  const dir = await mkdtemp(join(tmpdir(), "togopic-"));
  const htmlPath = join(dir, "figure.html");
  await writeFile(htmlPath, html, "utf8");
  try {
    await new Promise<void>((resolve, reject) => {
      const args = [
        "--headless",
        "--disable-gpu",
        "--no-pdf-header-footer",
        `--print-to-pdf=${outPath}`,
        `file://${htmlPath}`,
      ];
      const child = spawn(chrome, args, { stdio: "ignore" });
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 || existsSync(outPath)
          ? resolve()
          : reject(new Error(`Chrome exited with code ${code}`))
      );
    });
    return outPath;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
