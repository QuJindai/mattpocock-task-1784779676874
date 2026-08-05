import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.VRM_URL || 'https://vrm-showcase-lab.vercel.app';
const outputDir = 'v4-closeup-bakeoff';
const expectedBuild = 'visual-alicia-v4-3-20260805';
await mkdir(outputDir, { recursive: true });

const candidates = {
  idle: { distance: 2.35, height: 1.36, scale: 0.98, fov: 30, exposure: 0.68 },
  scale110: { distance: 2.05, height: 1.42, scale: 1.10, fov: 29, exposure: 0.66 },
  scale118: { distance: 2.05, height: 1.42, scale: 1.18, fov: 29, exposure: 0.66 },
  scale125: { distance: 2.05, height: 1.42, scale: 1.25, fov: 29, exposure: 0.66 },
  near118: { distance: 1.90, height: 1.34, scale: 1.18, fov: 30, exposure: 0.66 },
  tight125: { distance: 1.82, height: 1.30, scale: 1.25, fov: 31, exposure: 0.65 },
};

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const results = {};

async function inspect(name, input) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const query = new URLSearchParams({
    mode: 'capture',
    action: 'idle',
    emotion: 'relaxed',
    distance: String(input.distance),
    height: String(input.height),
    exposure: String(input.exposure),
    scale: String(input.scale),
    fov: String(input.fov),
    x: '0',
  });
  try {
    await page.goto(`${baseUrl}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(
      () => document.querySelector('#model-status')?.textContent === '角色已就绪',
      undefined,
      { timeout: 90_000 },
    );
    await page.waitForTimeout(3_200);
    const metrics = await page.evaluate(() => {
      const lab = window.__vrmLab;
      const gl = lab?.renderer?.getContext?.();
      const canvas = lab?.renderer?.domElement;
      if (!lab?.vrm || !gl || !canvas) return null;
      const width = canvas.width;
      const height = canvas.height;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let minX = width, maxX = -1, minYGl = height, maxYGl = -1, count = 0, luma = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4;
          if (pixels[index + 3] <= 24) continue;
          count += 1;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minYGl = Math.min(minYGl, y);
          maxYGl = Math.max(maxYGl, y);
          luma += 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
        }
      }
      return {
        buildId: lab.buildId ?? null,
        state: lab.state ?? null,
        scenePosition: lab.vrm.scene.position.toArray(),
        averageLuma: count ? luma / count : null,
        bounds: count ? {
          minX,
          maxX,
          minY: height - 1 - maxYGl,
          maxY: height - 1 - minYGl,
          width: maxX - minX + 1,
          height: maxYGl - minYGl + 1,
          canvasWidth: width,
          canvasHeight: height,
          count,
        } : null,
      };
    });
    if (!metrics || metrics.buildId !== expectedBuild) throw new Error(`${name}: invalid build ${metrics?.buildId}`);
    await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true });
    await page.locator('canvas').screenshot({ path: `${outputDir}/${name}-canvas.png` });
    results[name] = { ok: true, input, metrics, url: page.url() };
  } catch (error) {
    results[name] = { ok: false, input, error: error.stack || error.message };
    await page.screenshot({ path: `${outputDir}/${name}-failed.png`, fullPage: true }).catch(() => {});
  } finally {
    await page.close();
  }
}

for (const [name, input] of Object.entries(candidates)) await inspect(name, input);
await browser.close();

const idle = results.idle?.metrics?.bounds;
for (const [name, result] of Object.entries(results)) {
  if (name === 'idle' || !result.ok || !idle || !result.metrics.bounds) continue;
  const b = result.metrics.bounds;
  result.comparison = {
    widthRatio: b.width / idle.width,
    pixelRatio: b.count / idle.count,
    topRatio: b.minY / b.canvasHeight,
    heightRatio: b.height / b.canvasHeight,
  };
  const c = result.comparison;
  result.passesGate = c.widthRatio >= 1.15 && c.pixelRatio >= 1.12 && c.topRatio >= 0.055 && c.topRatio <= 0.24 && c.heightRatio >= 0.65;
  result.score = Math.abs(c.widthRatio - 1.22) + Math.abs(c.pixelRatio - 1.30) * 0.5 + Math.max(0, c.topRatio - 0.18) * 2;
}

const ranked = Object.entries(results)
  .filter(([name, result]) => name !== 'idle' && result.ok)
  .sort(([, a], [, b]) => (a.passesGate === b.passesGate ? a.score - b.score : a.passesGate ? -1 : 1))
  .map(([name, result]) => ({ name, ...result }));

await writeFile(
  `${outputDir}/results.json`,
  `${JSON.stringify({ expectedBuild, results, ranked }, null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify({ ranked: ranked.map(x => ({ name: x.name, passesGate: x.passesGate, comparison: x.comparison, score: x.score })) }, null, 2));
if (!ranked.some(result => result.passesGate)) process.exitCode = 1;
