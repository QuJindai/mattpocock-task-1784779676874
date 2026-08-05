import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.LOCAL_V45_URL || 'http://127.0.0.1:4173';
const outputDir = 'v46-neutral-export-probe';
await mkdir(outputDir, { recursive: true });
const candidates = {
  layered: `${baseUrl}/models/v46-layered.vrm`,
  sweater: `${baseUrl}/models/v46-sweater.vrm`,
  casual: `${baseUrl}/models/v46-casual.vrm`,
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const results = {};
for (const [name, url] of Object.entries(candidates)) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  const query = new URLSearchParams({
    mode: 'capture', framing: 'standard', action: 'idle', emotion: 'neutral',
    distance: '2.35', height: '1.36', exposure: '0.68', scale: '0.98', fov: '30', x: '0', url,
  });
  try {
    await page.goto(`${baseUrl}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => document.querySelector('#model-status')?.textContent === '角色已就绪', undefined, { timeout: 60_000 });
    await page.waitForTimeout(2_500);
    const metrics = await page.evaluate(() => ({
      buildId: window.__vrmLab?.buildId ?? null,
      state: window.__vrmLab?.state ?? null,
      sceneRotation: window.__vrmLab?.vrm?.scene?.rotation?.toArray?.() ?? null,
      sceneScale: window.__vrmLab?.vrm?.scene?.scale?.toArray?.() ?? null,
      scenePosition: window.__vrmLab?.vrm?.scene?.position?.toArray?.() ?? null,
    }));
    await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true });
    await page.locator('canvas').screenshot({ path: `${outputDir}/${name}-canvas.png` });
    results[name] = { ok: errors.length === 0, url, metrics, errors };
  } catch (error) {
    results[name] = { ok: false, url, error: error.stack || error.message, errors };
    await page.screenshot({ path: `${outputDir}/${name}-failed.png`, fullPage: true }).catch(() => {});
  } finally {
    await page.close();
  }
}
await browser.close();
await writeFile(`${outputDir}/results.json`, `${JSON.stringify({ results }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(results, null, 2));
if (Object.values(results).some(result => !result.ok)) process.exitCode = 1;
