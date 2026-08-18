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

/** Write `html` to a temp file and print it to `outPath` as PDF. Throws if no Chrome. */
export async function htmlToPdf(html: string, outPath: string): Promise<string> {
  const chrome = findChrome();
  if (!chrome) {
    throw new Error(
      "No Chrome/Chromium found for PDF rendering. Set CHROME_PATH, or request format:'html' and print it yourself."
    );
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
