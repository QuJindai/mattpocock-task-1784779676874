import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

const baseUrl = process.env.VRM_URL || 'https://vrm-showcase-lab.vercel.app';
const outputDir = 'v45-night-smoke';
const expectedBuild = 'visual-alicia-v4-5-20260805';
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
const pageErrors = [];
const requests = [];
page.on('pageerror', error => pageErrors.push(error.stack || error.message));
page.on('request', request => requests.push(request.url()));

function sampleRegion(png, region) {
  const { x, y, width, height } = region;
  let r = 0, g = 0, b = 0, n = 0;
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const i = (py * png.width + px) * 4;
      if (png.data[i + 3] < 200) continue;
      r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2]; n += 1;
    }
  }
  return n ? { r: r / n, g: g / n, b: b / n, luma: (0.2126 * r + 0.7152 * g + 0.0722 * b) / n, count: n } : null;
}

try {
  await page.goto(`${baseUrl}/?mode=capture&framing=standard&action=idle&emotion=relaxed&distance=2.35&height=1.36&exposure=0.68&scale=0.98&fov=30&x=0`, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  await page.waitForFunction(
    () => document.querySelector('#model-status')?.textContent === '角色已就绪',
    undefined,
    { timeout: 90_000 },
  );
  await page.waitForTimeout(3_200);

  const dom = await page.evaluate(() => {
    const lab = window.__vrmLab;
    const names = ['wall', 'night-window', 'city', 'floor', 'sofa', 'lamp', 'plant', 'foreground'];
    const layers = Object.fromEntries(names.map(name => {
      const el = document.querySelector(`.${name}`);
      if (!el) return [name, null];
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return [name, {
        display: style.display,
        visibility: style.visibility,
        opacity: Number(style.opacity || 1),
        width: rect.width,
        height: rect.height,
        backgroundImage: style.backgroundImage,
        backgroundColor: style.backgroundColor,
      }];
    }));
    return {
      buildId: lab?.buildId ?? null,
      state: lab?.state ?? null,
      theme: lab?.state?.theme ?? null,
      sceneAttribute: document.querySelector('.bg')?.dataset.scene ?? null,
      bodyText: document.body.innerText,
      layers,
    };
  });

  if (dom.buildId !== expectedBuild) errors.push(`wrong build: ${dom.buildId}`);
  if (dom.theme !== 'night-apartment') errors.push(`wrong runtime theme: ${dom.theme}`);
  if (dom.sceneAttribute !== 'night-apartment') errors.push(`wrong scene attribute: ${dom.sceneAttribute}`);
  for (const [name, layer] of Object.entries(dom.layers)) {
    if (!layer) errors.push(`missing night layer: ${name}`);
    else if (layer.display === 'none' || layer.visibility === 'hidden' || layer.opacity <= 0 || layer.width < 3 || layer.height < 3) {
      errors.push(`night layer not visible: ${name} ${JSON.stringify(layer)}`);
    }
  }
  if (requests.some(url => url.includes('images.unsplash.com'))) errors.push('remote Unsplash background request still present');
  if (dom.bodyText.includes('V4.5 加载失败')) errors.push('V4.5 loader reported failure');
  if (pageErrors.length) errors.push(`page errors:\n${pageErrors.join('\n')}`);

  const image = await page.screenshot({ path: `${outputDir}/night-idle.png`, fullPage: true });
  await page.locator('canvas').screenshot({ path: `${outputDir}/night-idle-canvas.png` });
  const png = PNG.sync.read(image);
  const warm = sampleRegion(png, { x: 80, y: 360, width: 430, height: 310 });
  const cool = sampleRegion(png, { x: 1050, y: 115, width: 430, height: 390 });
  const floor = sampleRegion(png, { x: 110, y: 700, width: 380, height: 130 });

  if (!warm || !cool || !floor) errors.push('night screenshot region sampling failed');
  else {
    if (warm.r - warm.b < 12) errors.push(`warm region lacks amber bias: ${JSON.stringify(warm)}`);
    if (cool.b - cool.r < 10) errors.push(`window region lacks blue bias: ${JSON.stringify(cool)}`);
    if (warm.luma < 18 || warm.luma > 145) errors.push(`warm region luma outside night range: ${warm.luma}`);
    if (cool.luma < 12 || cool.luma > 135) errors.push(`cool region luma outside night range: ${cool.luma}`);
    if (floor.luma > 90) errors.push(`floor is too bright for night scene: ${floor.luma}`);
    if (Math.abs(warm.luma - cool.luma) < 4) errors.push(`warm/cool regions lack luminance separation: warm=${warm.luma}, cool=${cool.luma}`);
  }

  await writeFile(`${outputDir}/results.json`, `${JSON.stringify({ expectedBuild, dom, warm, cool, floor, errors }, null, 2)}\n`, 'utf8');
  await writeFile(`${outputDir}/page.html`, await page.content(), 'utf8');
} catch (error) {
  errors.push(error.stack || error.message);
  await page.screenshot({ path: `${outputDir}/night-failed.png`, fullPage: true }).catch(() => {});
  await writeFile(`${outputDir}/results.json`, `${JSON.stringify({ expectedBuild, errors }, null, 2)}\n`, 'utf8');
} finally {
  await browser.close();
}

console.log(JSON.stringify({ expectedBuild, errors }, null, 2));
if (errors.length) process.exitCode = 1;
