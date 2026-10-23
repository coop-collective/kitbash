// Screenshot one story from a running Storybook dev server, for visual self-review.
// Usage: node scripts/shot.mjs <story-id> [--port 6006] [--theme light|dark] [--out file.png] [--width 900]
import { chromium } from "playwright";

const args = process.argv.slice(2);
const id = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!id) {
  console.error("usage: node scripts/shot.mjs <story-id> [--port 6006] [--theme light|dark] [--out file.png]");
  process.exit(2);
}
const port = opt("port", "6006");
const theme = opt("theme", "light");
const out = opt("out", `shot-${id}-${theme}.png`);
const width = Number(opt("width", "900"));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: 700 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(`http://localhost:${port}/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`);
await page.waitForSelector("#storybook-root > *", { timeout: 20000 });
await page.waitForTimeout(Number(opt("wait", "900")));
const box = await page.locator("#storybook-root .kb-stage > *").first().boundingBox();
const pad = 24;
await page.screenshot(
  box
    ? { path: out, fullPage: true, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 } }
    : { path: out, fullPage: true },
);
await browser.close();
console.log(out);
if (errors.length) {
  console.error(`page errors:\n${errors.join("\n")}`);
  process.exit(1);
}
