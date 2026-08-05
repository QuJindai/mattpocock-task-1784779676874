import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.VRM_URL || 'https://vrm-showcase-lab.vercel.app';
const outputDir = 'v46-character-bakeoff';
const expectedBuild = 'visual-alicia-v4-5-20260805';
const candidates = {
  '038-kate': 'https://arweave.net/1q4IQwLQXJVS0JGSpeXlRdazmZYdwJbmLbTv7o0s5Y8',
  '052-jennifer': 'https://arweave.net/LKp1uJLAZFmncdCNSZ8oopU7ZElXTvn4BmM4CUcFclc',
  '058-shiro': 'https://arweave.net/7skrWhSd_4mrqe-tiqMfCL746xu8UWghRh1dZm7irzM',
  '060-angry': 'https://arweave.net/g3xaZFRmx1O4gT-4equ6pmUMmR2HWRdbc_iFB3-m7ug',
  '226-eugenia': 'https://arweave.net/saOexMViu7mqSeaXfQzNIPrKWQ0nqkSf-FpOQjZfBcU',
  '270-anna': 'https://arweave.net/RqDioyluCcxDNHFPoXLUlbEQjhP1Fy9HtaGzLFVh0mE',
};

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const results = {};

async function inspect(name, url) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  const requestFailures = [];
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  page.on('requestfailed', request => requestFailures.push(`${request.url()} :: ${request.failure()?.errorText}`));
  const query = new URLSearchParams({
    mode: 'capture',
    framing: 'standard',
    action: 'idle',
    emotion: 'relaxed',
    distance: '2.35',
    height: '1.36',
    exposure: '0.68',
    scale: '0.98',
    fov: '30',
    x: '0',
    url,
  });
  const started = Date.now();
  try {
    await page.goto(`${baseUrl}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(
      () => document.querySelector('#model-status')?.textContent === '角色已就绪',
      undefined,
      { timeout: 45_000 },
    );
    const readyMs = Date.now() - started;
    await page.waitForTimeout(2_000);
    const metrics = await page.evaluate(() => {
      const lab = window.__vrmLab;
      const gl = lab?.renderer?.getContext?.();
      const canvas = lab?.renderer?.domElement;
      if (!lab?.vrm || !gl || !canvas) return null;
      const width = canvas.width;
      const height = canvas.height;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let minX = width, maxX = -1, minY = height, maxY = -1, count = 0, luma = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          if (pixels[i + 3] <= 24) continue;
          count += 1;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          luma += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
        }
      }
      return {
        buildId: lab.buildId ?? null,
        state: lab.state ?? null,
        metaVersion: String(lab.vrm.meta?.metaVersion ?? lab.vrm.meta?.specVersion ?? ''),
        count,
        averageLuma: count ? luma / count : null,
        bounds: count ? {
          minX, maxX,
          minY: height - 1 - maxY,
          maxY: height - 1 - minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
          canvasWidth: width,
          canvasHeight: height,
        } : null,
      };
    });
    if (!metrics) throw new Error('runtime metrics unavailable');
    if (metrics.buildId !== expectedBuild) throw new Error(`wrong build ${metrics.buildId}`);
    await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true });
    await page.locator('canvas').screenshot({ path: `${outputDir}/${name}-canvas.png` });
    results[name] = { ok: true, url, readyMs, metrics, pageErrors, requestFailures };
  } catch (error) {
    results[name] = { ok: false, url, readyMs: Date.now() - started, error: error.stack || error.message, pageErrors, requestFailures };
    await page.screenshot({ path: `${outputDir}/${name}-failed.png`, fullPage: true }).catch(() => {});
  } finally {
    await page.close();
  }
}

const entries = Object.entries(candidates);
for (let i = 0; i < entries.length; i += 2) {
  await Promise.all(entries.slice(i, i + 2).map(([name, url]) => inspect(name, url)));
}
await browser.close();

await writeFile(`${outputDir}/results.json`, `${JSON.stringify({ expectedBuild, results }, null, 2)}\n`, 'utf8');
const passed = Object.entries(results).filter(([, result]) => result.ok).map(([name]) => name);
console.log(JSON.stringify({ passed, failed: Object.keys(results).filter(name => !results[name].ok) }, null, 2));
if (passed.length < 3) process.exitCode = 1;
