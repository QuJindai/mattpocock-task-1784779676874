import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.VRM_URL || 'https://vrm-showcase-lab.vercel.app';
const outputDir = 'artifacts';
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
page.on('console', (message) => logs.push(`[console:${message.type()}] ${message.text()}`));
page.on('pageerror', (error) => logs.push(`[pageerror] ${error.stack || error.message}`));
page.on('requestfailed', (request) => logs.push(`[requestfailed] ${request.url()} :: ${request.failure()?.errorText}`));

async function capture(name, query = '') {
  const url = `${baseUrl}/${query ? `?${query}` : ''}`;
  logs.push(`[navigate] ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });

  try {
    await page.waitForFunction(
      () => document.querySelector('#status')?.textContent?.includes('模型已就绪'),
      undefined,
      { timeout: 120_000 },
    );
  } catch {
    logs.push(`[warning] ${name}: model did not reach ready state before timeout`);
  }

  await page.waitForTimeout(3_000);
  await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true });
  await writeFile(`${outputDir}/${name}.html`, await page.content(), 'utf8');
}

await capture('01-idle', 'action=idle&emotion=neutral&distance=2.75&height=1.35&exposure=0.76');
await capture('02-wave', 'action=wave&emotion=happy&distance=2.75&height=1.35&exposure=0.76');
await capture('03-closeup', 'action=idle&emotion=relaxed&distance=2.15&height=1.43&exposure=0.72');
await writeFile(`${outputDir}/browser.log`, `${logs.join('\n')}\n`, 'utf8');
await browser.close();
