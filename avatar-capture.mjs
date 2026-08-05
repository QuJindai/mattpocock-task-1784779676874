import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.AVATAR_URL || 'https://avatar-showcase-lab.vercel.app';
const outputDir = 'avatar-artifacts';
const sourceImage = 'https://huggingface.co/spaces/KlingTeam/LivePortrait/resolve/main/assets/examples/source/s9.jpg';
const expectedBackend = 'fffiloni/expression-editor';
const expectedEndpoint = '/edit_expression';

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
  if (['document', 'script'].includes(request.resourceType())) {
    fatalErrors.push(`[requestfailed] ${text}`);
  }
});

async function fail(message) {
  await page.screenshot({ path: `${outputDir}/failed.png`, fullPage: true }).catch(() => {});
  await writeFile(`${outputDir}/failed.html`, await page.content(), 'utf8').catch(() => {});
  throw new Error(message);
}

async function setRange(id, value) {
  const locator = page.locator(`#${id}`);
  await locator.evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
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

  const backendValue = await page.inputValue('#backend');
  if (backendValue !== expectedBackend) {
    await fail(`unexpected backend: ${backendValue}`);
  }

  await page.fill('#character', sourceImage);
  await page.click('#reload');
  await page.waitForTimeout(5_000);
  await page.screenshot({ path: `${outputDir}/02-source-portrait.png`, fullPage: true });

  await page.click('#connect');
  await page.waitForFunction(
    () => ['GPU已连接', 'GPU连接失败'].includes(document.querySelector('#gpu-status')?.textContent || ''),
    undefined,
    { timeout: 180_000 },
  );

  const connectionState = await page.locator('#gpu-status').textContent();
  if (connectionState !== 'GPU已连接') {
    const detail = await page.locator('#gpu-detail').textContent();
    await fail(`Advanced LivePortrait API discovery failed: ${detail}`);
  }

  const apiInfo = await page.evaluate(() => ({
    endpoint: window.__avatarLab?.imageEndpoint,
    backend: window.__avatarLab?.state?.backend,
    named: Object.keys(window.__avatarLab?.apiInfo?.named_endpoints || {}),
    unnamed: Object.keys(window.__avatarLab?.apiInfo?.unnamed_endpoints || {}),
  }));
  if (apiInfo.endpoint !== expectedEndpoint) {
    await fail(`unexpected expression endpoint: ${JSON.stringify(apiInfo)}`);
  }
  if (apiInfo.backend !== expectedBackend) {
    await fail(`unexpected connected backend: ${JSON.stringify(apiInfo)}`);
  }
  await writeFile(`${outputDir}/api-info.json`, `${JSON.stringify(apiInfo, null, 2)}\n`, 'utf8');
  await page.screenshot({ path: `${outputDir}/03-api-connected.png`, fullPage: true });

  const expression = {
    pitch: -3,
    yaw: 8,
    roll: 2,
    blink: -1,
    eyebrow: 4,
    wink: 1,
    pupilX: 2,
    pupilY: -1,
    aaa: 18,
    eee: 0,
    woo: 0,
    smile: 0.45,
    cropFactor: 1.7,
  };
  for (const [id, value] of Object.entries(expression)) await setRange(id, value);

  const before = await page.inputValue('#character');
  const generationStartedAt = Date.now();
  await page.click('#generate-frame');
  await page.waitForFunction(
    () => ['GPU结果已载入', 'GPU生成失败'].includes(document.querySelector('#gpu-status')?.textContent || ''),
    undefined,
    { timeout: 240_000 },
  );
  const generationElapsedMs = Date.now() - generationStartedAt;

  const generationState = await page.locator('#gpu-status').textContent();
  const generationDetail = await page.locator('#gpu-detail').textContent();
  if (generationState !== 'GPU结果已载入') {
    await fail(`Advanced LivePortrait generation failed: ${generationDetail}`);
  }

  const after = await page.inputValue('#character');
  if (!after.startsWith('http') || after === before) {
    await fail(`generated asset was not applied: before=${before} after=${after}`);
  }
  if (!after.includes('fffiloni-expression-editor.hf.space')) {
    await fail(`generated URL is not from the verified expression backend: ${after}`);
  }

  await page.waitForTimeout(5_000);
  await page.screenshot({ path: `${outputDir}/04-gpu-result.png`, fullPage: true });
  const resultCanvas = await page.locator('canvas.stage').screenshot({
    path: `${outputDir}/04-gpu-result-canvas.png`,
  });
  if (resultCanvas.length < 50_000) {
    await fail(`rendered result canvas is unexpectedly small: ${resultCanvas.length} bytes`);
  }
  await writeFile(`${outputDir}/result-url.txt`, `${after}\n`, 'utf8');

  const captureUrl = new URL('/capture', baseUrl);
  captureUrl.searchParams.set('character', after);
  captureUrl.searchParams.set('action', 'happy');
  captureUrl.searchParams.set('scale', '1.15');
  await page.goto(captureUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('canvas.stage', { timeout: 30_000 });
  await page.waitForTimeout(5_000);
  const captureImage = await page.screenshot({ path: `${outputDir}/05-capture.png`, fullPage: true });
  if (captureImage.length < 50_000) {
    await fail(`capture output is unexpectedly small: ${captureImage.length} bytes`);
  }

  if (fatalErrors.length > 0) await fail(fatalErrors.join('\n'));
  await writeFile(`${outputDir}/browser.log`, `${logs.join('\n')}\n`, 'utf8');
  await writeFile(
    `${outputDir}/results.json`,
    `${JSON.stringify({
      status: 'pass',
      apiInfo,
      expression,
      generatedUrl: after,
      generationElapsedMs,
      generationDetail,
      resultCanvasBytes: resultCanvas.length,
      resultCanvasSha256: sha256(resultCanvas),
      captureBytes: captureImage.length,
      captureSha256: sha256(captureImage),
      fatalErrors,
    }, null, 2)}\n`,
    'utf8',
  );
  console.log('Avatar showcase Advanced LivePortrait acceptance passed');
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
