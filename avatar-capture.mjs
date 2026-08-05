import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.AVATAR_URL || 'https://avatar-showcase-lab.vercel.app';
const accessUrl = process.env.AVATAR_ACCESS_URL || '';
const outputDir = 'avatar-artifacts';
const expectedRuntime = 'https://ezvfqrhzucjvkwnnbjux.supabase.co/functions/v1/avatar-motion-runtime';
const expectedBackend = 'fffiloni/expression-editor';
const expectedEndpoint = '/edit_expression';
const sessionKey = 'avatar-showcase.generated-character';

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
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
  if (['document', 'script'].includes(request.resourceType())) fatalErrors.push(`[requestfailed] ${text}`);
});

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
async function fail(message) {
  await page.screenshot({ path: `${outputDir}/failed.png`, fullPage: true }).catch(() => {});
  await writeFile(`${outputDir}/failed.html`, await page.content(), 'utf8').catch(() => {});
  throw new Error(message);
}
async function waitForRuntime() {
  await page.waitForFunction(
    () => ['运行时已连接', '运行时失败'].includes(document.querySelector('#gpu-status')?.textContent || ''),
    undefined,
    { timeout: 120_000 },
  );
  const status = await page.locator('#gpu-status').textContent();
  if (status !== '运行时已连接') await fail(`runtime connection failed: ${await page.locator('#gpu-detail').textContent()}`);
}
async function selectPreset(name) {
  await page.click(`[data-preset="${name}"]`);
  await page.waitForFunction(
    (preset) => window.__avatarLab?.state?.preset === preset && document.querySelector(`[data-preset="${preset}"]`)?.classList.contains('on'),
    name,
  );
  return await page.evaluate(() => ({ ...window.__avatarLab.state }));
}

try {
  if (accessUrl) {
    await page.goto(accessUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForTimeout(2_500);
    logs.push(`[access-bootstrap] ${page.url()}`);
  }
  await page.goto(`${baseUrl}/studio`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('canvas.stage', { timeout: 60_000 });
  await page.waitForSelector('#character-proof', { timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector('#loading-card')?.classList.contains('hide'), undefined, { timeout: 120_000 });
  await waitForRuntime();
  await page.waitForTimeout(3_000);

  const assetProof = await page.evaluate(() => ({
    character: document.querySelector('#character-proof')?.textContent,
    background: document.querySelector('#background-proof')?.textContent,
    characterField: document.querySelector('#character')?.value,
    backgroundField: document.querySelector('#background')?.value,
    runtime: document.querySelector('#backend')?.value,
    vignette: Boolean(document.querySelector('.stage-vignette')),
  }));
  if (!assetProof.character?.includes('1344×1728') || !assetProof.character?.includes('透明PNG')) await fail(`formal character proof failed: ${JSON.stringify(assetProof)}`);
  if (!assetProof.background?.includes('2016×1152') || !assetProof.background?.includes('夜景')) await fail(`formal background proof failed: ${JSON.stringify(assetProof)}`);
  if (assetProof.characterField !== 'asset:character' || assetProof.backgroundField !== 'asset:background') await fail(`formal asset markers failed: ${JSON.stringify(assetProof)}`);
  if (assetProof.runtime !== expectedRuntime || !assetProof.vignette) await fail(`visual runtime contract failed: ${JSON.stringify(assetProof)}`);

  const apiInfo = await page.evaluate(() => ({
    endpoint: window.__avatarLab?.imageEndpoint,
    runtimeUrl: window.__avatarLab?.runtimeUrl,
    backend: window.__avatarLab?.apiInfo?.backend,
    assets: window.__avatarLab?.apiInfo?.assets,
    ok: window.__avatarLab?.apiInfo?.ok,
  }));
  if (apiInfo.endpoint !== expectedEndpoint || apiInfo.runtimeUrl !== expectedRuntime || apiInfo.backend !== expectedBackend || apiInfo.ok !== true) await fail(`runtime API mismatch: ${JSON.stringify(apiInfo)}`);
  if (!apiInfo.assets?.includes('character') || !apiInfo.assets?.includes('background')) await fail(`runtime asset registry missing: ${JSON.stringify(apiInfo)}`);
  await writeFile(`${outputDir}/api-info.json`, `${JSON.stringify(apiInfo, null, 2)}\n`);

  const calm = await selectPreset('calm');
  if (calm.action !== 'idle' || calm.smile !== 0.22 || calm.scale !== 1.02) await fail(`calm preset mismatch: ${JSON.stringify(calm)}`);
  const calmShot = await page.screenshot({ path: `${outputDir}/01-calm.png`, fullPage: true });

  const happy = await selectPreset('happy');
  if (happy.action !== 'happy' || happy.smile !== 0.56 || happy.warmth !== 0.25) await fail(`happy preset mismatch: ${JSON.stringify(happy)}`);
  await page.waitForTimeout(1_000);
  const happyShot = await page.screenshot({ path: `${outputDir}/02-happy.png`, fullPage: true });

  const listening = await selectPreset('listening');
  if (listening.action !== 'listen' || listening.yaw !== 7 || listening.blur !== 2.4) await fail(`listening preset mismatch: ${JSON.stringify(listening)}`);
  await page.waitForTimeout(1_000);
  const listeningShot = await page.screenshot({ path: `${outputDir}/03-listening.png`, fullPage: true });

  if (sha256(calmShot) === sha256(happyShot) || sha256(happyShot) === sha256(listeningShot)) await fail('preset screenshots are identical');

  await selectPreset('happy');
  const startedAt = Date.now();
  await page.click('#generate-frame');
  await page.waitForFunction(
    () => ['正式表情已载入', 'GPU生成失败'].includes(document.querySelector('#gpu-status')?.textContent || ''),
    undefined,
    { timeout: 240_000 },
  );
  const generationElapsedMs = Date.now() - startedAt;
  const generationStatus = await page.locator('#gpu-status').textContent();
  const generationDetail = await page.locator('#gpu-detail').textContent();
  if (generationStatus !== '正式表情已载入') await fail(`formal expression failed: ${generationDetail}`);

  const proof = await page.evaluate(async (key) => {
    const session = sessionStorage.getItem(key);
    const image = new Image();
    image.src = session || '';
    await image.decode();
    return {
      field: document.querySelector('#character')?.value,
      sessionLength: session?.length || 0,
      sessionPrefix: session?.slice(0, 32),
      image: { width: image.naturalWidth, height: image.naturalHeight },
      last: window.__avatarLab?.lastGeneration,
    };
  }, sessionKey);
  if (proof.field !== 'session:generated' || !proof.sessionPrefix?.startsWith('data:image/webp;base64,')) await fail(`generated session marker failed: ${JSON.stringify(proof)}`);
  if (proof.image.width !== 1344 || proof.image.height !== 1728 || proof.sessionLength < 20_000) await fail(`generated formal image contract failed: ${JSON.stringify(proof)}`);
  if (proof.last?.backend !== expectedBackend || proof.last?.endpoint !== expectedEndpoint || proof.last?.alphaPreserved !== true || proof.last?.imageBytes < 10_000) await fail(`generation proof failed: ${JSON.stringify(proof.last)}`);

  await page.waitForTimeout(3_000);
  const gpuShot = await page.screenshot({ path: `${outputDir}/04-gpu-expression.png`, fullPage: true });
  const gpuCanvas = await page.locator('canvas.stage').screenshot({ path: `${outputDir}/04-gpu-expression-canvas.png` });
  if (gpuShot.length < 500_000 || gpuCanvas.length < 300_000) await fail(`formal render unexpectedly small: full=${gpuShot.length} canvas=${gpuCanvas.length}`);

  await page.goto(`${baseUrl}/capture?character=session%3Agenerated&preset=happy&action=happy`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('canvas.stage', { timeout: 60_000 });
  await page.waitForTimeout(5_000);
  const capture = await page.screenshot({ path: `${outputDir}/05-capture.png`, fullPage: true });
  if (capture.length < 500_000) await fail(`capture image unexpectedly small: ${capture.length}`);
  if (fatalErrors.length) await fail(fatalErrors.join('\n'));

  const result = {
    status: 'pass', baseUrl, assetProof, apiInfo,
    presets: { calm, happy, listening },
    generationElapsedMs, generationDetail, generated: proof,
    screenshotBytes: { calm: calmShot.length, happy: happyShot.length, listening: listeningShot.length, gpu: gpuShot.length, gpuCanvas: gpuCanvas.length, capture: capture.length },
    hashes: { calm: sha256(calmShot), happy: sha256(happyShot), listening: sha256(listeningShot), gpu: sha256(gpuShot), gpuCanvas: sha256(gpuCanvas), capture: sha256(capture) },
    fatalErrors,
  };
  await writeFile(`${outputDir}/browser.log`, `${logs.join('\n')}\n`);
  await writeFile(`${outputDir}/results.json`, `${JSON.stringify(result, null, 2)}\n`);
  console.log('Avatar Showcase v0.6 formal visual acceptance passed');
} catch (error) {
  logs.push(`[fatal] ${error.stack || error.message}`);
  await writeFile(`${outputDir}/browser.log`, `${logs.join('\n')}\n`);
  await writeFile(`${outputDir}/results.json`, `${JSON.stringify({ status: 'fail', baseUrl, error: error.stack || error.message, fatalErrors }, null, 2)}\n`);
  throw error;
} finally {
  await browser.close();
}
