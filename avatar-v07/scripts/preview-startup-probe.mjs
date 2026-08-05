import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = (process.env.AVATAR_URL || '').replace(/\/$/, '');
const accessUrl = process.env.AVATAR_ACCESS_URL || '';
const outputDir = 'avatar-v07-startup-probe';
if (!baseUrl) throw new Error('AVATAR_URL is required');
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const events = [];
page.on('console', (message) => events.push({ type: `console:${message.type()}`, text: message.text() }));
page.on('pageerror', (error) => events.push({ type: 'pageerror', text: error.stack || error.message }));
page.on('requestfailed', (request) => events.push({
  type: 'requestfailed',
  resourceType: request.resourceType(),
  url: request.url(),
  error: request.failure()?.errorText,
}));
page.on('response', (response) => {
  if (response.status() >= 400) {
    events.push({
      type: 'http-error',
      status: response.status(),
      resourceType: response.request().resourceType(),
      url: response.url(),
    });
  }
});

try {
  if (accessUrl) {
    await page.goto(accessUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForTimeout(2_000);
    events.push({ type: 'access', url: page.url() });
  }
  await page.goto(`${baseUrl}/showcase?autoplay=0`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForTimeout(10_000);
  const documentState = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    baseHref: document.querySelector('base')?.href || '',
    scripts: [...document.scripts].map((script) => ({ src: script.src, type: script.type })),
    styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.href),
    canvasCount: document.querySelectorAll('canvas.stage').length,
    bodyClass: document.body.className,
    avatarLabType: typeof window.__avatarLab,
    avatarLab: window.__avatarLab ? {
      ready: window.__avatarLab.ready,
      mode: window.__avatarLab.mode,
      degraded: window.__avatarLab.degraded,
      assetBase: window.__avatarLab.assetBase,
      frameBase: window.__avatarLab.frameBase,
    } : null,
    bodyText: document.body.innerText.slice(0, 1000),
  }));
  await page.screenshot({ path: `${outputDir}/startup.png`, fullPage: true });
  await writeFile(`${outputDir}/page.html`, await page.content(), 'utf8');
  await writeFile(`${outputDir}/probe.json`, `${JSON.stringify({ documentState, events }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ documentState, events }, null, 2));
  if (documentState.canvasCount < 1) throw new Error('canvas.stage did not appear');
} finally {
  await browser.close();
}
