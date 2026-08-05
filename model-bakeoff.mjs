import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.VRM_URL || 'https://vrm-showcase-lab.vercel.app';
const outputDir = 'model-bakeoff';
await mkdir(outputDir, { recursive: true });

const candidates = {
  shino: 'https://file-in-abyss.soga-web.studio/download/vrm/06-sendagaya-shino.vrm',
  vita: 'https://file-in-abyss.soga-web.studio/download/vrm/03-vita.vrm',
  victoria: 'https://file-in-abyss.soga-web.studio/download/vrm/04-victoria-rubin.vrm',
};

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist','--enable-webgl','--enable-unsafe-swiftshader','--use-angle=swiftshader-webgl'],
});

const results = {};
const preset = 'mode=capture&action=idle&emotion=relaxed&distance=2.05&height=1.36&exposure=0.72&scale=1.08&fov=29&x=0.02';

async function inspect(name, modelUrl) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`));
  const url = `${baseUrl}/?${preset}&url=${encodeURIComponent(modelUrl)}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(
      () => ['角色已就绪','加载失败'].includes(document.querySelector('#model-status')?.textContent),
      undefined,
      { timeout: 25_000 },
    );
    await page.waitForTimeout(1_500);
    const state = await page.evaluate(() => ({
      status: document.querySelector('#model-status')?.textContent,
      error: window.__vrmLab?.error ?? null,
      buildId: window.__vrmLab?.buildId ?? null,
      metaVersion: window.__vrmLab?.vrm ? String(window.__vrmLab.vrm.meta?.metaVersion ?? window.__vrmLab.vrm.meta?.specVersion ?? '') : null,
      fitDebug: window.__vrmLab?.fitDebug ?? null,
    }));
    await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true });
    await writeFile(`${outputDir}/${name}.html`, await page.content(), 'utf8');
    results[name] = { ok: state.status === '角色已就绪', url, state, errors };
  } catch (error) {
    await page.screenshot({ path: `${outputDir}/${name}-timeout.png`, fullPage: true }).catch(() => {});
    results[name] = { ok: false, url, error: error.stack || error.message, errors };
  } finally {
    await page.close();
  }
}

await Promise.all(Object.entries(candidates).map(([name, url]) => inspect(name, url)));
await browser.close();
await writeFile(`${outputDir}/results.json`, `${JSON.stringify(results, null, 2)}\n`, 'utf8');

const passed = Object.values(results).filter(result => result.ok).length;
console.log(`Model bake-off complete: ${passed}/${Object.keys(results).length} loaded`);
if (passed === 0) process.exitCode = 2;
