import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'v46-characterstudio-probe';
const url = 'https://m3-org.github.io/CharacterStudio/';
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const pageErrors = [];
const requests = [];
page.on('pageerror', error => pageErrors.push(error.stack || error.message));
page.on('requestfailed', request => requests.push(`${request.url()} :: ${request.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 });
await page.waitForTimeout(6_000);

const snapshot = await page.evaluate(() => ({
  title: document.title,
  url: location.href,
  bodyText: document.body.innerText.slice(0, 20_000),
  buttons: [...document.querySelectorAll('button')].map((button, index) => ({
    index,
    text: button.innerText.trim(),
    aria: button.getAttribute('aria-label'),
    title: button.getAttribute('title'),
    className: button.className,
    disabled: button.disabled,
  })),
  links: [...document.querySelectorAll('a')].map((link, index) => ({ index, text: link.innerText.trim(), href: link.href })),
  inputs: [...document.querySelectorAll('input')].map((input, index) => ({
    index,
    type: input.type,
    name: input.name,
    value: input.value,
    placeholder: input.placeholder,
  })),
  globals: Object.keys(window).filter(key => /character|scene|manifest/i.test(key)).sort(),
}));

await page.screenshot({ path: `${output}/page.png`, fullPage: true });
await writeFile(`${output}/page.html`, await page.content(), 'utf8');
await writeFile(`${output}/snapshot.json`, `${JSON.stringify({ snapshot, pageErrors, requests }, null, 2)}\n`, 'utf8');
await browser.close();

console.log(JSON.stringify({ title: snapshot.title, buttons: snapshot.buttons.length, errors: pageErrors.length }, null, 2));
if (pageErrors.length) process.exitCode = 1;
