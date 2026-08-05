import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = (process.env.AVATAR_URL || '').replace(/\/$/, '');
const accessUrl = process.env.AVATAR_ACCESS_URL || '';
const expectedCommit = process.env.AVATAR_ASSET_COMMIT || '';
const outputDir = 'avatar-v07-artifacts';
if (!baseUrl) throw new Error('AVATAR_URL is required');
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const logs = [];
const fatalErrors = [];
const results = {};
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');

function attachDiagnostics(page, label) {
  page.on('console', (message) => logs.push(`[${label}][console:${message.type()}] ${message.text()}`));
  page.on('pageerror', (error) => {
    const text = error.stack || error.message;
    fatalErrors.push(`[${label}][pageerror] ${text}`);
    logs.push(`[${label}][pageerror] ${text}`);
  });
  page.on('requestfailed', (request) => {
    const text = `${request.resourceType()} ${request.url()} :: ${request.failure()?.errorText}`;
    logs.push(`[${label}][requestfailed] ${text}`);
    if (['document', 'script', 'fetch', 'xhr', 'image'].includes(request.resourceType())) {
      fatalErrors.push(`[${label}][requestfailed] ${text}`);
    }
  });
}

async function newPage(label) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  attachDiagnostics(page, label);
  return page;
}

async function bootstrapAccess(page) {
  if (!accessUrl) return;
  await page.goto(accessUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForTimeout(2_000);
  logs.push(`[access] ${page.url()}`);
}

async function waitReady(page, timeout = 120_000) {
  await page.waitForSelector('canvas.stage', { timeout });
  await page.waitForFunction(() => window.__avatarLab?.ready === true, undefined, { timeout });
  const proof = await page.evaluate(() => ({
    rendererKind: window.__avatarLab?.rendererKind,
    degraded: window.__avatarLab?.degraded,
    mode: window.__avatarLab?.mode,
    assetBase: window.__avatarLab?.assetBase,
    frameBase: window.__avatarLab?.frameBase,
    background: window.__avatarLab?.background,
    manifest: window.__avatarLab?.manifest,
    diagnostics: window.__avatarLab?.diagnostics,
  }));
  if (proof.rendererKind !== 'frame-blend') throw new Error(`unexpected renderer: ${proof.rendererKind}`);
  if (proof.degraded) throw new Error(`application entered degraded mode: ${JSON.stringify(proof)}`);
  if (!proof.background || proof.background.degraded) throw new Error(`formal background failed: ${JSON.stringify(proof.background)}`);
  if (expectedCommit && !proof.assetBase?.includes(expectedCommit)) {
    throw new Error(`asset base is not pinned to ${expectedCommit}: ${proof.assetBase}`);
  }
  const frames = proof.manifest?.frames || {};
  const required = ['idle-open', 'blink-half', 'blink-closed', 'happy', 'listen', 'mouth-a', 'mouth-e', 'mouth-u'];
  if (required.some((id) => !frames[id])) throw new Error('manifest is missing required semantic frames');
  if (frames['blink-half'].expression?.blink !== -10 || frames['blink-closed'].expression?.blink !== -20) {
    throw new Error('validated blink parameters are not present in the manifest');
  }
  return proof;
}

async function saveScreenshot(page, fileName) {
  const buffer = await page.screenshot({ path: `${outputDir}/${fileName}`, fullPage: true });
  if (buffer.length < 100_000) throw new Error(`${fileName} is unexpectedly small: ${buffer.length}`);
  return { bytes: buffer.length, sha256: hash(buffer) };
}

async function setSemanticState(page, state, expression) {
  await page.evaluate(({ state, expression }) => {
    window.__avatarLab.pauseAutoplay();
    window.__avatarLab.setState(state);
    if (expression) window.__avatarLab.setExpression(expression);
  }, { state, expression });
  await page.waitForFunction((expected) => {
    const diagnostics = window.__avatarLab?.diagnostics?.controller;
    return diagnostics?.state === expected && diagnostics?.renderer?.currentFrame != null;
  }, state, { timeout: 20_000 });
  await page.waitForTimeout(500);
}

try {
  const page = await newPage('showcase');
  await bootstrapAccess(page);
  await page.goto(`${baseUrl}/showcase?autoplay=0&state=idle&expression=neutral`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const initialProof = await waitReady(page);
  if (await page.locator('.studio-panel').isVisible()) throw new Error('Studio panel is visible in showcase mode');
  results.initial = initialProof;

  await setSemanticState(page, 'idle', 'neutral');
  results.idle = await saveScreenshot(page, '01-showcase-idle.png');
  await setSemanticState(page, 'happy', 'happy');
  results.happy = await saveScreenshot(page, '02-showcase-happy.png');
  await setSemanticState(page, 'listen', 'focused');
  results.listen = await saveScreenshot(page, '03-showcase-listen.png');
  await setSemanticState(page, 'talk', 'soft-smile');
  const mouthFrames = new Set();
  const talkStarted = Date.now();
  while (Date.now() - talkStarted < 1_800) {
    const frame = await page.evaluate(() => window.__avatarLab?.diagnostics?.controller?.renderer?.currentFrame);
    if (frame) mouthFrames.add(frame);
    await page.waitForTimeout(70);
  }
  for (const frame of ['mouth-a', 'mouth-e', 'mouth-u']) {
    if (!mouthFrames.has(frame)) throw new Error(`talk animation did not use ${frame}: ${[...mouthFrames].join(',')}`);
  }
  results.talkFrames = [...mouthFrames];
  results.talk = await saveScreenshot(page, '04-showcase-talk.png');
  const semanticHashes = new Set([results.idle.sha256, results.happy.sha256, results.listen.sha256, results.talk.sha256]);
  if (semanticHashes.size !== 4) throw new Error('semantic showcase screenshots are not distinct');
  await page.close();

  const blinkPage = await newPage('blink');
  await bootstrapAccess(blinkPage);
  await blinkPage.goto(`${baseUrl}/capture?state=idle&autoplay=0&time=3950`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitReady(blinkPage);
  const halfFrame = await blinkPage.evaluate(() => window.__avatarLab?.diagnostics?.controller?.renderer?.currentFrame);
  if (halfFrame !== 'blink-half') throw new Error(`expected blink-half at 3950ms, got ${halfFrame}`);
  await blinkPage.goto(`${baseUrl}/capture?state=idle&autoplay=0&time=4000`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitReady(blinkPage);
  const closedFrame = await blinkPage.evaluate(() => window.__avatarLab?.diagnostics?.controller?.renderer?.currentFrame);
  if (closedFrame !== 'blink-closed') throw new Error(`expected blink-closed at 4000ms, got ${closedFrame}`);
  results.blink = { halfFrame, closedFrame };
  await blinkPage.close();

  const captureUrl = `${baseUrl}/capture?state=listen&expression=focused&autoplay=0&time=12500&scale=1.04&x=-36&y=16&warmth=0.2&blur=1.4&parallax=10&exposure=1`;
  const captureHashes = [];
  for (let index = 0; index < 2; index += 1) {
    const capturePage = await newPage(`capture-${index + 1}`);
    await bootstrapAccess(capturePage);
    await capturePage.goto(captureUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await waitReady(capturePage);
    if (await capturePage.locator('.studio-panel').isVisible()) throw new Error('Studio panel is visible in capture mode');
    const proof = await saveScreenshot(capturePage, `05-capture-fixed-time-${index + 1}.png`);
    captureHashes.push(proof.sha256);
    await capturePage.close();
  }
  if (captureHashes[0] !== captureHashes[1]) throw new Error(`deterministic capture hashes differ: ${captureHashes.join(' vs ')}`);
  results.deterministicCaptureSha256 = captureHashes[0];

  const restorePage = await newPage('restore');
  await bootstrapAccess(restorePage);
  const restoreUrl = `${baseUrl}/studio?renderer=frame-blend&character=formal-v1&state=happy&expression=happy&autoplay=0&scale=1.17&x=18&y=-12&warmth=0.24&blur=2.2&parallax=14&exposure=0.93`;
  await restorePage.goto(restoreUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitReady(restorePage);
  await restorePage.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitReady(restorePage);
  const restored = await restorePage.evaluate(() => window.__avatarLab.state);
  const expectedRestore = {
    renderer: 'frame-blend', character: 'formal-v1', state: 'happy', expression: 'happy', autoplay: false,
    scale: 1.17, x: 18, y: -12, warmth: 0.24, blur: 2.2, parallax: 14, exposure: 0.93, time: null,
  };
  if (JSON.stringify(restored) !== JSON.stringify(expectedRestore)) throw new Error(`URL state restoration mismatch: ${JSON.stringify({ restored, expectedRestore })}`);
  results.restore = restored;
  results.studio = await saveScreenshot(restorePage, '06-studio.png');
  await restorePage.close();

  const autoplayPage = await newPage('autoplay');
  await bootstrapAccess(autoplayPage);
  await autoplayPage.goto(`${baseUrl}/showcase?autoplay=1&state=idle&expression=neutral`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitReady(autoplayPage);
  const observedPhases = new Set();
  const autoplayStarted = Date.now();
  while (Date.now() - autoplayStarted < 24_500) {
    const phase = await autoplayPage.evaluate(() => window.__avatarLab?.diagnostics?.timeline?.phase);
    if (phase) observedPhases.add(phase);
    await autoplayPage.waitForTimeout(250);
  }
  for (const phase of ['idle', 'happy', 'listen', 'talk']) {
    if (!observedPhases.has(phase)) throw new Error(`autoplay did not reach ${phase}: ${[...observedPhases].join(',')}`);
  }
  results.autoplayPhases = [...observedPhases];
  await autoplayPage.close();

  if (fatalErrors.length) throw new Error(fatalErrors.join('\n'));
  results.status = 'pass';
  results.baseUrl = baseUrl;
  results.expectedCommit = expectedCommit;
  await writeFile(`${outputDir}/browser.log`, `${logs.join('\n')}\n`, 'utf8');
  await writeFile(`${outputDir}/results.json`, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  console.log('Avatar Showcase v0.7 cloud acceptance passed');
} catch (error) {
  results.status = 'fail';
  results.error = error.stack || error.message;
  results.fatalErrors = fatalErrors;
  await writeFile(`${outputDir}/browser.log`, `${logs.join('\n')}\n`, 'utf8');
  await writeFile(`${outputDir}/results.json`, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  throw error;
} finally {
  await browser.close();
}
