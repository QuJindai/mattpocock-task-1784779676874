import { chromium } from 'playwright';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const baseUrl = process.env.STUDIO_URL || 'http://127.0.0.1:4173';
const outputDir = process.env.OUTPUT_DIR || 'v46-neurohacker-export';
await mkdir(outputDir, { recursive: true });

const variants = {
  layered: {
    traits: [
      ['body', '0'],
      ['eyes', 'regulareyes'],
      ['head', 'hairshort'],
      ['chest', 'simpleshirt'],
      ['outer', 'longjacket'],
      ['legs', 'tightjeans'],
      ['feet', 'simpleshoes'],
    ],
    colors: {
      body: '#E4B69F',
      eyes: '#4B3028',
      head: '#5A2E28',
      chest: '#201E24',
      outer: '#E7D8C7',
      legs: '#151821',
      feet: '#29282D',
    },
  },
  sweater: {
    traits: [
      ['body', '0'],
      ['eyes', 'regulareyes'],
      ['head', 'short'],
      ['chest', 'sweater'],
      ['legs', 'tightjeans'],
      ['feet', 'simpleshoes'],
    ],
    colors: {
      body: '#E4B69F',
      eyes: '#4B3028',
      head: '#5A2E28',
      chest: '#E7D8C7',
      legs: '#151821',
      feet: '#29282D',
    },
  },
  casual: {
    traits: [
      ['body', '0'],
      ['eyes', 'regulareyes'],
      ['head', 'hairshort'],
      ['chest', 'sweater'],
      ['legs', 'workingpants'],
      ['feet', 'runningshoes'],
    ],
    colors: {
      body: '#E4B69F',
      eyes: '#4B3028',
      head: '#5A2E28',
      chest: '#E7D8C7',
      legs: '#171A20',
      feet: '#2B2B31',
    },
  },
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader-webgl',
    '--disable-dev-shm-usage',
  ],
});

const results = {};

for (const [name, variant] of Object.entries(variants)) {
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const pageErrors = [];
  const requestFailures = [];
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  page.on('requestfailed', request => requestFailures.push(`${request.url()} :: ${request.failure()?.errorText}`));

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(
      () => window.__characterStudioManager && window.__characterStudioCamera && window.__characterStudioControls,
      undefined,
      { timeout: 60_000 },
    );

    const assembly = await page.evaluate(async ({ traits, colors }) => {
      const manager = window.__characterStudioManager;
      const camera = window.__characterStudioCamera;
      const controls = window.__characterStudioControls;
      const manifestUrl = new URL('/character-assets/neurohacker/manifest.json', location.href).href;

      await manager.loadManifest(manifestUrl, 'v46');
      for (const [group, id] of traits) {
        await manager.loadTrait(group, id, 'v46');
      }
      for (const [group, color] of Object.entries(colors)) {
        manager.setTraitColor(group, color);
      }
      manager.updateCullHiddenMeshes();
      manager.toggleCharacterLookAtMouse(false);

      controls.target.set(0, 0.92, 0);
      camera.position.set(0, 1.08, 2.65);
      controls.update();
      camera.updateMatrixWorld(true);
      manager.characterModel.updateMatrixWorld(true);

      return {
        selection: manager.getAvatarSelection(),
        triangles: manager.getBoneTriangleCount?.() ?? null,
        canDownload: manager.canDownload(),
        manifest: manager.manifestData?.collectionID ?? null,
      };
    }, variant);

    await page.waitForTimeout(2_000);
    await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true });
    const canvas = page.locator('#editor-scene');
    if (await canvas.count()) {
      await canvas.screenshot({ path: `${outputDir}/${name}-canvas.png` });
    }

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 120_000 }),
      page.evaluate(async name => {
        await window.__characterStudioManager.downloadVRM(`v46-${name}`, {
          mToonAtlasSize: 2048,
          mToonAtlasSizeTransp: 1024,
          exportMtoonAtlas: true,
          exportStdAtlas: false,
          screenshotResolution: [512, 512],
          screenshotBackground: [0.08, 0.08, 0.1],
        });
      }, name),
    ]);

    const modelPath = path.resolve(`${outputDir}/v46-${name}.vrm`);
    await download.saveAs(modelPath);
    const bytes = await readFile(modelPath);
    const fileStat = await stat(modelPath);
    const header = bytes.subarray(0, 4).toString('ascii');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const modelValid = header === 'glTF' && fileStat.size >= 500_000;

    results[name] = {
      ok: modelValid && pageErrors.length === 0,
      assembly,
      file: {
        path: modelPath,
        size: fileStat.size,
        header,
        sha256,
        suggestedFilename: download.suggestedFilename(),
      },
      pageErrors,
      requestFailures,
    };
  } catch (error) {
    results[name] = {
      ok: false,
      error: error.stack || error.message,
      pageErrors,
      requestFailures,
    };
    await page.screenshot({ path: `${outputDir}/${name}-failed.png`, fullPage: true }).catch(() => {});
  } finally {
    await context.close();
  }
}

await browser.close();
await writeFile(`${outputDir}/results.json`, `${JSON.stringify({ baseUrl, results }, null, 2)}\n`, 'utf8');
const passed = Object.entries(results).filter(([, result]) => result.ok).map(([name]) => name);
console.log(JSON.stringify({ passed, results }, null, 2));
if (passed.length < 2) process.exitCode = 1;
