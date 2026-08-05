import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.VRM_URL || 'https://vrm-showcase-lab.vercel.app';
const outputDir = 'model-bakeoff';
await mkdir(outputDir, { recursive: true });

// All three URLs point to the same AliciaSolid.vrm blob from three.js r110.
// The purpose of this run is to select a stable browser-readable mirror,
// not to compare different character assets.
const candidates = {
  aliciaJsDelivr: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r110/examples/models/vrm/Alicia/AliciaSolid.vrm',
  aliciaRawGitHub: 'https://raw.githubusercontent.com/mrdoob/three.js/r110/examples/models/vrm/Alicia/AliciaSolid.vrm',
  aliciaRawGithack: 'https://rawcdn.githack.com/mrdoob/three.js/r110/examples/models/vrm/Alicia/AliciaSolid.vrm',
};

const expectedBuildId = 'visual-material-light-v3-20260805';
const browser = await chromium.launch({
  headless: true,
  args: [
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader-webgl',
  ],
});

const results = {};
const preset = 'mode=capture&action=idle&emotion=relaxed&distance=2.05&height=1.36&exposure=0.72&scale=1.08&fov=29&x=0.02';

async function inspect(name, modelUrl) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  const responses = [];

  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', request => {
    errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`);
  });
  page.on('response', response => {
    if (response.url() === modelUrl) {
      responses.push({
        url: response.url(),
        status: response.status(),
        contentType: response.headers()['content-type'] ?? null,
        contentLength: response.headers()['content-length'] ?? null,
        accessControlAllowOrigin: response.headers()['access-control-allow-origin'] ?? null,
      });
    }
  });

  const url = `${baseUrl}/?${preset}&url=${encodeURIComponent(modelUrl)}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35_000 });
    await page.waitForFunction(
      () => ['角色已就绪', '加载失败'].includes(document.querySelector('#model-status')?.textContent),
      undefined,
      { timeout: 35_000 },
    );
    await page.waitForTimeout(2_000);

    const state = await page.evaluate(() => {
      const lab = window.__vrmLab;
      return {
        status: document.querySelector('#model-status')?.textContent ?? null,
        error: lab?.error ?? null,
        buildId: lab?.buildId ?? null,
        metaVersion: lab?.vrm
          ? String(lab.vrm.meta?.metaVersion ?? lab.vrm.meta?.specVersion ?? '')
          : null,
        fitDebug: lab?.fitDebug ?? null,
        modelUrl: lab?.state?.url ?? null,
      };
    });

    await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true });
    await page.locator('canvas').screenshot({ path: `${outputDir}/${name}-canvas.png` });
    await writeFile(`${outputDir}/${name}.html`, await page.content(), 'utf8');

    const ok = state.status === '角色已就绪' && state.buildId === expectedBuildId;
    results[name] = { ok, url, modelUrl, state, responses, errors };
  } catch (error) {
    await page.screenshot({ path: `${outputDir}/${name}-timeout.png`, fullPage: true }).catch(() => {});
    results[name] = {
      ok: false,
      url,
      modelUrl,
      error: error.stack || error.message,
      responses,
      errors,
    };
  } finally {
    await page.close();
  }
}

await Promise.all(Object.entries(candidates).map(([name, url]) => inspect(name, url)));
await browser.close();

const passedNames = Object.entries(results)
  .filter(([, result]) => result.ok)
  .map(([name]) => name);

await writeFile(
  `${outputDir}/results.json`,
  `${JSON.stringify({ expectedBuildId, passedNames, results }, null, 2)}\n`,
  'utf8',
);

console.log(`Alicia mirror bake-off complete: ${passedNames.length}/${Object.keys(results).length} loaded`);
console.log(`Passed mirrors: ${passedNames.join(', ') || 'none'}`);
if (passedNames.length === 0) process.exitCode = 2;
