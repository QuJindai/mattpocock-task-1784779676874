import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'v46-characterstudio-create-probe';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.stack || error.message));

await page.goto('https://studio.m3org.com/', { waitUntil: 'networkidle', timeout: 120_000 });
await page.waitForTimeout(3_000);
await page.locator('button').nth(0).click();
await page.waitForTimeout(8_000);

const snapshot = await page.evaluate(() => ({
  title: document.title,
  url: location.href,
  bodyText: document.body.innerText.slice(0, 40_000),
  buttons: [...document.querySelectorAll('button')].map((button, index) => ({
    index,
    text: button.innerText.trim(),
    aria: button.getAttribute('aria-label'),
    title: button.getAttribute('title'),
    className: button.className,
    disabled: button.disabled,
    img: button.querySelector('img')?.getAttribute('src') ?? null,
  })),
  links: [...document.querySelectorAll('a')].map((link, index) => ({ index, text: link.innerText.trim(), href: link.href })),
  inputs: [...document.querySelectorAll('input')].map((input, index) => ({
    index,
    type: input.type,
    name: input.name,
    value: input.value,
    placeholder: input.placeholder,
    className: input.className,
  })),
  images: [...document.querySelectorAll('img')].map((img, index) => ({ index, src: img.getAttribute('src'), alt: img.alt, title: img.title })),
  selects: [...document.querySelectorAll('select')].map((select, index) => ({
    index,
    value: select.value,
    options: [...select.options].map(option => ({ value: option.value, text: option.text })),
  })),
  globals: Object.keys(window).filter(key => /character|scene|manifest|manager|studio/i.test(key)).sort(),
}));

await page.screenshot({ path: `${output}/page.png`, fullPage: true });
await writeFile(`${output}/page.html`, await page.content(), 'utf8');
await writeFile(`${output}/snapshot.json`, `${JSON.stringify({ snapshot, errors }, null, 2)}\n`, 'utf8');
await browser.close();
console.log(JSON.stringify({ url: snapshot.url, buttons: snapshot.buttons.length, inputs: snapshot.inputs.length, errors: errors.length }, null, 2));
if (errors.length) process.exitCode = 1;
