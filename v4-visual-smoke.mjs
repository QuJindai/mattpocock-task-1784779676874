import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const baseUrl = process.env.VRM_URL || 'https://vrm-showcase-lab.vercel.app';
const outputDir = 'v4-visual-smoke';
const buildId = 'visual-alicia-v4-2-20260805';
const defaultModel = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r110/examples/models/vrm/Alicia/AliciaSolid.vrm';

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader-webgl',
  ],
});

const scenarios = {
  idle: 'mode=capture&action=idle&emotion=relaxed&distance=2.35&height=1.36&exposure=0.68&scale=0.98&fov=30&x=0',
  wave: 'mode=capture&action=wave&emotion=happy&distance=2.35&height=1.36&exposure=0.68&scale=0.98&fov=30&x=0',
  closeup: 'mode=capture&action=idle&emotion=relaxed&distance=2.05&height=1.42&exposure=0.66&scale=0.96&fov=29&x=0',
};

const results = {};
const errors = [];
const digest = value => createHash('sha256').update(value).digest('hex');

function validateBounds(name, bounds) {
  if (!bounds) throw new Error(`${name}: rendered avatar bounds unavailable`);

  const topRatio = bounds.minY / bounds.canvasHeight;
  const heightRatio = bounds.height / bounds.canvasHeight;
  const widthRatio = bounds.width / bounds.canvasWidth;

  if (topRatio < 0.055) {
    throw new Error(`${name}: Alicia head/bow clips the top safe area: ${JSON.stringify({ topRatio, bounds })}`);
  }
  if (topRatio > 0.30) {
    throw new Error(`${name}: avatar is positioned too low: ${JSON.stringify({ topRatio, bounds })}`);
  }
  if (heightRatio < 0.45 || heightRatio > 0.93) {
    throw new Error(`${name}: avatar height is outside the visual framing range: ${JSON.stringify({ heightRatio, bounds })}`);
  }
  if (widthRatio < 0.14 || widthRatio > 0.78) {
    throw new Error(`${name}: avatar width is outside the visual framing range: ${JSON.stringify({ widthRatio, bounds })}`);
  }
}

for (const [name, query] of Object.entries(scenarios)) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  const requestFailures = [];

  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  page.on('requestfailed', request => {
    requestFailures.push(`${request.url()} :: ${request.failure()?.errorText}`);
  });

  try {
    await page.goto(`${baseUrl}/?${query}`, {
      waitUntil: 'domcontentloaded',
      timeout: 90_000,
    });
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

      let minX = width;
      let maxX = -1;
      let minYGl = height;
      let maxYGl = -1;
      let count = 0;
      let luma = 0;

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4;
          const alpha = pixels[index + 3];
          if (alpha <= 24) continue;

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
        fitDebug: lab.fitDebug ?? null,
        scenePosition: lab.vrm.scene.position.toArray(),
        metaVersion: String(lab.vrm.meta?.metaVersion ?? lab.vrm.meta?.specVersion ?? ''),
        count,
        averageLuma: count ? luma / count : null,
        bounds: count
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
          : null,
      };
    });

    if (!metrics) throw new Error(`${name}: runtime metrics unavailable`);
    if (metrics.buildId !== buildId) {
      throw new Error(`${name}: expected build ${buildId}, got ${metrics.buildId}`);
    }
    if (metrics.state?.url !== defaultModel) {
      throw new Error(`${name}: Alicia is not the default model: ${metrics.state?.url}`);
    }
    if (metrics.state?.action !== name && !(name === 'closeup' && metrics.state?.action === 'idle')) {
      throw new Error(`${name}: action state mismatch: ${metrics.state?.action}`);
    }
    if (pageErrors.length) {
      throw new Error(`${name}: page errors\n${pageErrors.join('\n')}`);
    }
    const fatalRequests = requestFailures.filter(item => item.includes('.vrm') || item.includes('three'));
    if (fatalRequests.length) {
      throw new Error(`${name}: fatal requests\n${fatalRequests.join('\n')}`);
    }
    if (!Number.isFinite(metrics.averageLuma) || metrics.averageLuma < 55 || metrics.averageLuma > 205) {
      throw new Error(`${name}: average avatar luma is outside range: ${metrics.averageLuma}`);
    }
    if (metrics.count < 40_000) {
      throw new Error(`${name}: too few rendered avatar pixels: ${metrics.count}`);
    }

    validateBounds(name, metrics.bounds);

    const fullImage = await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true });
    const canvasImage = await page.locator('canvas').screenshot({ path: `${outputDir}/${name}-canvas.png` });
    await writeFile(`${outputDir}/${name}.html`, await page.content(), 'utf8');

    results[name] = {
      ...metrics,
      fullHash: digest(fullImage),
      canvasHash: digest(canvasImage),
      url: page.url(),
    };
  } catch (error) {
    errors.push(error.stack || error.message);
    await page.screenshot({ path: `${outputDir}/${name}-failed.png`, fullPage: true }).catch(() => {});
    await writeFile(`${outputDir}/${name}-failed.html`, await page.content(), 'utf8').catch(() => {});
  } finally {
    await page.close();
  }
}

await browser.close();

if (results.idle && results.wave && results.idle.canvasHash === results.wave.canvasHash) {
  errors.push('idle and wave Alicia canvases are identical');
}
if (results.idle && results.closeup && results.idle.canvasHash === results.closeup.canvasHash) {
  errors.push('idle and closeup Alicia canvases are identical');
}

await writeFile(
  `${outputDir}/results.json`,
  `${JSON.stringify({ buildId, defaultModel, results, errors }, null, 2)}\n`,
  'utf8',
);

console.log(JSON.stringify({ buildId, defaultModel, passed: Object.keys(results), errors }, null, 2));
if (errors.length) process.exitCode = 1;
