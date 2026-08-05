import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.VRM_URL || 'https://vrm-showcase-lab.vercel.app';
const outputDir = 'v4-closeup-smoke';
const expectedBuild = 'visual-alicia-v4-3-20260805';
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});

const scenarios = {
  idle: 'mode=capture&action=idle&emotion=relaxed&distance=2.35&height=1.36&exposure=0.68&scale=0.98&fov=30&x=0',
  closeup: 'mode=capture&action=idle&emotion=relaxed&distance=2.05&height=1.42&exposure=0.66&scale=0.96&fov=29&x=0',
};
const results = {};
const errors = [];

async function capture(name, query) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
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
      let minX = width, maxX = -1, minYGl = height, maxYGl = -1, count = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const alpha = pixels[(y * width + x) * 4 + 3];
          if (alpha <= 24) continue;
          count += 1;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minYGl = Math.min(minYGl, y);
          maxYGl = Math.max(maxYGl, y);
        }
      }
      return {
        buildId: lab.buildId ?? null,
        state: lab.state ?? null,
        scenePosition: lab.vrm.scene.position.toArray(),
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

    if (!metrics) throw new Error(`${name}: metrics unavailable`);
    if (metrics.buildId !== expectedBuild) throw new Error(`${name}: wrong build ${metrics.buildId}`);
    if (!metrics.bounds) throw new Error(`${name}: bounds unavailable`);
    await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true });
    await page.locator('canvas').screenshot({ path: `${outputDir}/${name}-canvas.png` });
    results[name] = metrics;
  } catch (error) {
    errors.push(error.stack || error.message);
    await page.screenshot({ path: `${outputDir}/${name}-failed.png`, fullPage: true }).catch(() => {});
  } finally {
    await page.close();
  }
}

for (const [name, query] of Object.entries(scenarios)) await capture(name, query);
await browser.close();

if (results.idle && results.closeup) {
  const widthRatio = results.closeup.bounds.width / results.idle.bounds.width;
  const pixelRatio = results.closeup.bounds.count / results.idle.bounds.count;
  const topRatio = results.closeup.bounds.minY / results.closeup.bounds.canvasHeight;
  results.comparison = { widthRatio, pixelRatio, topRatio };

  if (widthRatio < 1.15) {
    errors.push(`closeup must be at least 15% wider than idle: widthRatio=${widthRatio}`);
  }
  if (pixelRatio < 1.12) {
    errors.push(`closeup must contain at least 12% more avatar pixels: pixelRatio=${pixelRatio}`);
  }
  if (topRatio < 0.055 || topRatio > 0.24) {
    errors.push(`closeup top safe area invalid: topRatio=${topRatio}`);
  }
}

await writeFile(
  `${outputDir}/results.json`,
  `${JSON.stringify({ expectedBuild, results, errors }, null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify({ expectedBuild, comparison: results.comparison, errors }, null, 2));
if (errors.length) process.exitCode = 1;
