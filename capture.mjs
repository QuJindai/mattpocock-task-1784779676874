import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const baseUrl = process.env.VRM_URL || 'https://vrm-showcase-lab.vercel.app';
const outputDir = 'artifacts';
await mkdir(outputDir, { recursive: true });

const models = {
  avatarA: 'https://cdn.jsdelivr.net/gh/madjin/vrm-samples@master/vroid/stable/AvatarSample_A.vrm',
  avatarB: 'https://cdn.jsdelivr.net/gh/madjin/vrm-samples@master/vroid/stable/AvatarSample_B.vrm',
  rose: 'https://arweave.net/Ea1KXujzJatQgCFSMzGOzp_UtHqB1pyia--U3AtkMAY',
  amazonas: 'https://arweave.net/fqZDwToo41u1a7VnHhZX1BTK5lktXpK_H6H20MVbPqQ',
  invalid: 'https://example.invalid/not-found.vrm',
};

const browser = await chromium.launch({
  headless: true,
  args: [
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader-webgl',
  ],
});

const logs = [];
const results = new Map();
const failures = [];

function hash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function capture({ name, query = '', expect = 'ready', verify }) {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  const pageErrors = [];
  const requestFailures = [];

  page.on('console', (message) => logs.push(`[${name}][console:${message.type()}] ${message.text()}`));
  page.on('pageerror', (error) => {
    const message = error.stack || error.message;
    pageErrors.push(message);
    logs.push(`[${name}][pageerror] ${message}`);
  });
  page.on('requestfailed', (request) => {
    const message = `${request.url()} :: ${request.failure()?.errorText}`;
    requestFailures.push({
      message,
      resourceType: request.resourceType(),
      url: request.url(),
    });
    logs.push(`[${name}][requestfailed] ${message}`);
  });

  const url = `${baseUrl}/${query ? `?${query}` : ''}`;
  logs.push(`[${name}][navigate] ${url}`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    const expectedText = expect === 'ready' ? '模型已就绪' : '加载失败';

    try {
      await page.waitForFunction(
        (text) => document.querySelector('#model-status')?.textContent === text,
        expectedText,
        { timeout: 120_000 },
      );
    } catch (error) {
      await page.screenshot({ path: `${outputDir}/${name}-failed.png`, fullPage: true });
      await writeFile(`${outputDir}/${name}-failed.html`, await page.content(), 'utf8');
      throw new Error(`${name}: model did not reach expected state '${expectedText}'`, { cause: error });
    }

    await page.waitForTimeout(2_000);

    if (verify) {
      await verify(page);
    }

    if (pageErrors.length > 0) {
      throw new Error(`${name}: page errors:\n${pageErrors.join('\n')}`);
    }

    const fatalRequestFailures = requestFailures.filter(({ resourceType, url: failedUrl }) => {
      if (expect === 'failure' && failedUrl.includes('example.invalid')) return false;
      return failedUrl.endsWith('.vrm') || ['document', 'script', 'fetch', 'xhr'].includes(resourceType);
    });
    if (fatalRequestFailures.length > 0) {
      throw new Error(
        `${name}: fatal request failures:\n${fatalRequestFailures.map((item) => item.message).join('\n')}`,
      );
    }

    const fullBuffer = await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true });
    const canvas = page.locator('canvas');
    const canvasBuffer = await canvas.screenshot({ path: `${outputDir}/${name}-canvas.png` });
    await writeFile(`${outputDir}/${name}.html`, await page.content(), 'utf8');

    results.set(name, {
      fullHash: hash(fullBuffer),
      canvasHash: hash(canvasBuffer),
      url: page.url(),
    });
    logs.push(`[${name}][pass] ${expect}`);
  } catch (error) {
    failures.push(error.stack || error.message);
    logs.push(`[${name}][failure] ${error.stack || error.message}`);
  } finally {
    await page.close();
  }
}

await capture({
  name: '01-idle',
  query: 'action=idle&emotion=neutral&distance=2.75&height=1.35&exposure=0.76',
});
await capture({
  name: '02-wave',
  query: 'action=wave&emotion=happy&distance=2.75&height=1.35&exposure=0.76',
});
await capture({
  name: '03-closeup',
  query: 'action=idle&emotion=relaxed&distance=2.15&height=1.43&exposure=0.72',
});
await capture({
  name: '04-rose',
  query: `url=${encodeURIComponent(models.rose)}&action=idle&emotion=happy&distance=2.75&height=1.35&exposure=0.76`,
});
await capture({
  name: '05-amazonas',
  query: `url=${encodeURIComponent(models.amazonas)}&action=idle&emotion=neutral&distance=2.75&height=1.35&exposure=0.76`,
});
await capture({
  name: '06-custom-success',
  query: `url=${encodeURIComponent(models.avatarB)}&action=listen&emotion=relaxed&distance=2.65&height=1.38&exposure=0.74`,
});
await capture({
  name: '07-custom-failure',
  query: `url=${encodeURIComponent(models.invalid)}`,
  expect: 'failure',
});
await capture({
  name: '08-restore-params',
  query: `url=${encodeURIComponent(models.avatarA)}&action=wave&emotion=happy&distance=2.25&height=1.46&exposure=0.71&scale=1.1`,
  verify: async (page) => {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(
      () => document.querySelector('#model-status')?.textContent === '模型已就绪',
      undefined,
      { timeout: 120_000 },
    );
    const restored = await page.evaluate(() => ({
      distance: document.querySelector('#distance')?.value,
      height: document.querySelector('#height')?.value,
      exposure: document.querySelector('#exposure')?.value,
      scale: document.querySelector('#scale')?.value,
      action: document.querySelector('[data-a].on')?.getAttribute('data-a'),
      emotion: document.querySelector('[data-e].on')?.getAttribute('data-e'),
      url: new URL(location.href).searchParams.get('url'),
    }));
    const expected = {
      distance: '2.25',
      height: '1.46',
      exposure: '0.71',
      scale: '1.1',
      action: 'wave',
      emotion: 'happy',
      url: models.avatarA,
    };
    if (JSON.stringify(restored) !== JSON.stringify(expected)) {
      throw new Error(`parameter restoration mismatch: ${JSON.stringify({ restored, expected })}`);
    }
  },
});

const idle = results.get('01-idle');
const wave = results.get('02-wave');
const closeup = results.get('03-closeup');
if (idle && wave && idle.canvasHash === wave.canvasHash) {
  failures.push('idle and wave canvas screenshots are identical');
}
if (idle && closeup && idle.canvasHash === closeup.canvasHash) {
  failures.push('idle and closeup canvas screenshots are identical');
}

await writeFile(`${outputDir}/browser.log`, `${logs.join('\n')}\n`, 'utf8');
await writeFile(
  `${outputDir}/results.json`,
  `${JSON.stringify({ results: Object.fromEntries(results), failures }, null, 2)}\n`,
  'utf8',
);
await browser.close();

if (failures.length > 0) {
  throw new Error(`VRM online acceptance failed:\n${failures.join('\n\n')}`);
}

console.log(`VRM online acceptance passed: ${results.size} scenarios`);
