import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.VRM_URL || 'https://vrm-showcase-lab.vercel.app';
const outputDir = 'v46-avatar-a-material-probe';
const avatarUrl = 'https://cdn.jsdelivr.net/gh/madjin/vrm-samples@master/vroid/stable/AvatarSample_A.vrm';
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.stack || error.message));
const query = new URLSearchParams({
  mode: 'capture', framing: 'standard', action: 'idle', emotion: 'relaxed',
  distance: '2.35', height: '1.36', exposure: '0.68', scale: '0.98', fov: '30', x: '0', url: avatarUrl,
});

await page.goto(`${baseUrl}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await page.waitForFunction(() => document.querySelector('#model-status')?.textContent === '角色已就绪', undefined, { timeout: 60_000 });
await page.waitForTimeout(3_200);

const data = await page.evaluate(() => {
  const lab = window.__vrmLab;
  const materials = [];
  const seen = new Set();
  lab.vrm.scene.traverse(object => {
    if (!object.isMesh) return;
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (!material || seen.has(material.uuid)) continue;
      seen.add(material.uuid);
      const mapInfo = texture => texture ? {
        uuid: texture.uuid,
        name: texture.name,
        colorSpace: texture.colorSpace,
        width: texture.image?.width ?? texture.source?.data?.width ?? null,
        height: texture.image?.height ?? texture.source?.data?.height ?? null,
      } : null;
      materials.push({
        uuid: material.uuid,
        objectName: object.name,
        name: material.name,
        type: material.type,
        color: material.color?.getHexString?.() ?? null,
        emissive: material.emissive?.getHexString?.() ?? null,
        emissiveIntensity: material.emissiveIntensity ?? null,
        opacity: material.opacity ?? null,
        transparent: material.transparent ?? null,
        toneMapped: material.toneMapped ?? null,
        roughness: material.roughness ?? null,
        metalness: material.metalness ?? null,
        map: mapInfo(material.map),
        shadeMultiplyTexture: mapInfo(material.shadeMultiplyTexture),
      });
    }
  });
  return {
    buildId: lab.buildId,
    state: lab.state,
    materialCount: materials.length,
    materials,
  };
});

await page.screenshot({ path: `${outputDir}/avatar-a.png`, fullPage: true });
await page.locator('canvas').screenshot({ path: `${outputDir}/avatar-a-canvas.png` });
await writeFile(`${outputDir}/materials.json`, `${JSON.stringify({ data, errors }, null, 2)}\n`, 'utf8');
await browser.close();
console.log(JSON.stringify({ buildId: data.buildId, materialCount: data.materialCount, errors }, null, 2));
if (errors.length || data.materialCount < 3) process.exitCode = 1;
