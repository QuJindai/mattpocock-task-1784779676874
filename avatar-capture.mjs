import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.AVATAR_URL || 'https://avatar-showcase-lab.vercel.app';
const outputDir = 'avatar-artifacts';
const sourceImage = 'https://huggingface.co/spaces/KlingTeam/LivePortrait/resolve/main/assets/examples/source/s9.jpg';

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

const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
});

const logs = [];
const fatalErrors = [];
page.on('console', (message) => logs.push(`[console:${message.type()}] ${message.text()}`));
page.on('pageerror', (error) => {
  const text = error.stack || error.message;
  fatalErrors.push(`[pageerror] ${text}`);
  logs.push(`[pageerror] ${text}`);
});
page.on('requestfailed', (request) => {
  const text = `${request.url()} :: ${request.failure()?.errorText}`;
  logs.push(`[requestfailed] ${text}`);
  const type = request.resourceType();
  if (['document', 'script', 'fetch', 'xhr'].includes(type)) fatalErrors.push(`[requestfailed] ${text}`);
});

async function fail(message) {
  await page.screenshot({ path: `${outputDir}/failed.png`, fullPage: true });
  await writeFile(`${outputDir}/failed.html`, await page.content(), 'utf8');
  throw new Error(message);
}

try {
  await page.goto(`${baseUrl}/studio`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('canvas.stage', { timeout: 30_000 });
  await page.waitForTimeout(5_000);
  await page.screenshot({ path: `${outputDir}/01-studio.png`, fullPage: true });

  const canvasBox = await page.locator('canvas.stage').boundingBox();
  if (!canvasBox || canvasBox.width < 800 || canvasBox.height < 500) {
    await fail(`invalid canvas size: ${JSON.stringify(canvasBox)}`);
  }

  await page.fill('#character', sourceImage);
  await page.click('#reload');
  await page.waitForTimeout(5_000);
  await page.screenshot({ path: `${outputDir}/02-source-portrait.png`, fullPage: true });

  await page.click('#connect');
  await page.waitForFunction(
    () => ['GPU已连接', 'GPU连接失败'].includes(document.querySelector('#gpu-status')?.textContent || ''),
    undefined,
    { timeout: 240_000 },
  );

  const connectionState = await page.locator('#gpu-status').textContent();
  if (connectionState !== 'GPU已连接') {
    const detail = await page.locator('#gpu-detail').textContent();
    await fail(`LivePortrait API discovery failed: ${detail}`);
  }

  const apiInfo = await page.evaluate(() => ({
    endpoint: window.__avatarLab?.imageEndpoint,
    named: Object.keys(window.__avatarLab?.apiInfo?.named_endpoints || {}),
    unnamed: Object.keys(window.__avatarLab?.apiInfo?.unnamed_endpoints || {}),
  }));
  if (!apiInfo.endpoint) await fail(`image endpoint missing: ${JSON.stringify(apiInfo)}`);
  await writeFile(`${outputDir}/api-info.json`, `${JSON.stringify(apiInfo, null, 2)}\n`, 'utf8');
  await page.screenshot({ path: `${outputDir}/03-api-connected.png`, fullPage: true });

  await page.fill('#eye', '0.45');
  await page.fill('#lip', '0.22');
  const before = await page.inputValue('#character');
  await page.click('#generate-frame');
  await page.waitForFunction(
    () => ['GPU结果已载入', 'GPU生成失败'].includes(document.querySelector('#gpu-status')?.textContent || ''),
    undefined,
    { timeout: 420_000 },
  );

  const generationState = await page.locator('#gpu-status').textContent();
  if (generationState !== 'GPU结果已载入') {
    const detail = await page.locator('#gpu-detail').textContent();
    await fail(`LivePortrait generation failed: ${detail}`);
  }

  const after = await page.inputValue('#character');
  if (!after.startsWith('http') || after === before) {
    await fail(`generated asset was not applied: before=${before} after=${after}`);
  }

  await page.waitForTimeout(5_000);
  await page.screenshot({ path: `${outputDir}/04-gpu-result.png`, fullPage: true });
  await page.locator('canvas.stage').screenshot({ path: `${outputDir}/04-gpu-result-canvas.png` });
  await writeFile(`${outputDir}/result-url.txt`, `${after}\n`, 'utf8');

  await page.goto(`${baseUrl}/capture?character=${encodeURIComponent(after)}&action=happy&scale=1.15`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });
  await page.waitForSelector('canvas.stage', { timeout: 30_000 });
  await page.waitForTimeout(5_000);
  await page.screenshot({ path: `${outputDir}/05-capture.png`, fullPage: true });

  if (fatalErrors.length > 0) await fail(fatalErrors.join('\n'));
  await writeFile(`${outputDir}/browser.log`, `${logs.join('\n')}\n`, 'utf8');
  await writeFile(
    `${outputDir}/results.json`,
    `${JSON.stringify({ status: 'pass', apiInfo, generatedUrl: after, fatalErrors }, null, 2)}\n`,
    'utf8',
  );
  console.log('Avatar showcase cloud acceptance passed');
} catch (error) {
  logs.push(`[fatal] ${error.stack || error.message}`);
  await writeFile(`${outputDir}/browser.log`, `${logs.join('\n')}\n`, 'utf8');
  await writeFile(
    `${outputDir}/results.json`,
    `${JSON.stringify({ status: 'fail', error: error.stack || error.message, fatalErrors }, null, 2)}\n`,
    'utf8',
  );
  throw error;
} finally {
  await browser.close();
}
