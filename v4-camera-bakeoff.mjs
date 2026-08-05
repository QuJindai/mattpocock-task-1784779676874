import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.VRM_URL || 'https://vrm-showcase-lab.vercel.app';
const outputDir = 'v4-camera-bakeoff';
const buildId = 'visual-alicia-v4-20260805';
await mkdir(outputDir, { recursive: true });

const candidates = {
  current: { distance: 2.05, height: 1.42, scale: 0.96, fov: 29 },
  lowerCamera: { distance: 2.05, height: 1.20, scale: 1.00, fov: 29 },
  portraitNear: { distance: 1.92, height: 1.20, scale: 1.02, fov: 29 },
  portraitTight: { distance: 1.82, height: 1.16, scale: 1.00, fov: 30 },
};

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});

const results = {};

async function readMetrics(page) {
  return page.evaluate(() => {
    const lab = window.__vrmLab;
    const gl = lab?.renderer?.getContext?.();
    const canvas = lab?.renderer?.domElement;
    if (!lab?.vrm || !gl || !canvas) return null;

    const width = canvas.width;
    const height = canvas.height;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let minX = width;
    let maxX = -1;
    let minYGl = height;
    let maxYGl = -1;
    let count = 0;
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

    const bounds = count
      ? {
          minX,
          maxX,
          minY: height - 1 - maxYGl,
          maxY: height - 1 - minYGl,
          width: maxX - minX + 1,
          height: maxYGl - minYGl + 1,
          canvasWidth: width,
          canvasHeight: height,
        }
      : null;

    return {
      buildId: lab.buildId ?? null,
      state: lab.state ?? null,
      scenePosition: lab.vrm.scene.position.toArray(),
      sceneScale: lab.vrm.scene.scale.toArray(),
      cameraPosition: lab.camera.position.toArray(),
      cameraQuaternion: lab.camera.quaternion.toArray(),
      fitDebug: lab.fitDebug ?? null,
      count,
      bounds,
      ratios: bounds
        ? {
            top: bounds.minY / bounds.canvasHeight,
            height: bounds.height / bounds.canvasHeight,
            width: bounds.width / bounds.canvasWidth,
          }
        : null,
    };
  });
}

for (const [name, camera] of Object.entries(candidates)) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const query = new URLSearchParams({
    mode: 'capture',
    action: 'idle',
    emotion: 'relaxed',
    exposure: '0.66',
    x: '0',
    distance: String(camera.distance),
    height: String(camera.height),
    scale: String(camera.scale),
    fov: String(camera.fov),
  });

  try {
    await page.goto(`${baseUrl}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(
      () => document.querySelector('#model-status')?.textContent === '角色已就绪',
      undefined,
      { timeout: 90_000 },
    );
    await page.waitForTimeout(2_500);
    const metrics = await readMetrics(page);
    if (!metrics || metrics.buildId !== buildId) {
      throw new Error(`${name}: invalid runtime build ${metrics?.buildId}`);
    }
    await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true });
    await page.locator('canvas').screenshot({ path: `${outputDir}/${name}-canvas.png` });
    results[name] = { ok: true, input: camera, metrics, url: page.url() };
  } catch (error) {
    await page.screenshot({ path: `${outputDir}/${name}-failed.png`, fullPage: true }).catch(() => {});
    results[name] = { ok: false, input: camera, error: error.stack || error.message };
  } finally {
    await page.close();
  }
}

await browser.close();
await writeFile(`${outputDir}/results.json`, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(results, null, 2));
if (!Object.values(results).some(result => result.ok)) process.exitCode = 1;
