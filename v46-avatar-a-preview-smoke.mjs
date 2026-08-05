import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const baseUrl = process.env.PREVIEW_URL || 'http://127.0.0.1:4173';
const outputDir = 'v46-avatar-a-preview-smoke';
const buildId = 'visual-avatar-a-v4-6-20260805';
const defaultModel = 'https://cdn.jsdelivr.net/gh/madjin/vrm-samples@master/vroid/stable/AvatarSample_A.vrm';
await mkdir(outputDir, { recursive: true });

const scenarios = {
  idle: 'mode=capture&framing=standard&action=idle&emotion=relaxed&distance=2.35&height=1.36&exposure=0.68&scale=0.98&fov=30&x=0',
  wave: 'mode=capture&framing=standard&action=wave&emotion=happy&distance=2.35&height=1.36&exposure=0.68&scale=0.98&fov=30&x=0',
  closeup: 'mode=capture&framing=closeup&action=idle&emotion=relaxed&distance=2.35&height=1.36&exposure=0.66&scale=0.98&fov=30&x=0',
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const results = {};
const errors = [];
const digest = data => createHash('sha256').update(data).digest('hex');

function validateBounds(name, bounds) {
  if (!bounds) throw new Error(`${name}: bounds unavailable`);
  const topRatio = bounds.minY / bounds.canvasHeight;
  const heightRatio = bounds.height / bounds.canvasHeight;
  const widthRatio = bounds.width / bounds.canvasWidth;
  const maxHeight = name === 'closeup' ? 0.98 : 0.93;
  if (topRatio < 0.05 || topRatio > 0.30) throw new Error(`${name}: top ratio invalid ${topRatio}`);
  if (heightRatio < 0.45 || heightRatio > maxHeight) throw new Error(`${name}: height ratio invalid ${heightRatio}`);
  if (widthRatio < 0.14 || widthRatio > 0.78) throw new Error(`${name}: width ratio invalid ${widthRatio}`);
}

for (const [name, query] of Object.entries(scenarios)) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  const requestFailures = [];
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  page.on('requestfailed', request => requestFailures.push(`${request.url()} :: ${request.failure()?.errorText}`));
  try {
    await page.goto(`${baseUrl}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => document.querySelector('#model-status')?.textContent === '角色已就绪', undefined, { timeout: 60_000 });
    await page.waitForTimeout(3_200);
    const metrics = await page.evaluate(() => {
      const lab = window.__vrmLab;
      const gl = lab?.renderer?.getContext?.();
      const canvas = lab?.renderer?.domElement;
      if (!lab?.vrm || !gl || !canvas) return null;
      const width = canvas.width;
      const height = canvas.height;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let minX = width, maxX = -1, minY = height, maxY = -1, count = 0, luma = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          if (pixels[i + 3] <= 24) continue;
          count += 1;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          luma += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
        }
      }
      const materials = [];
      const seen = new Set();
      lab.vrm.scene.traverse(object => {
        if (!object.isMesh) return;
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (!material || seen.has(material.uuid)) continue;
          seen.add(material.uuid);
          materials.push({
            name: material.name,
            color: material.color?.getHexString?.() ?? null,
            emissiveIntensity: material.emissiveIntensity ?? null,
          });
        }
      });
      return {
        buildId: lab.buildId,
        state: lab.state,
        count,
        averageLuma: count ? luma / count : null,
        bounds: count ? {
          minX, maxX,
          minY: height - 1 - maxY,
          maxY: height - 1 - minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
          canvasWidth: width,
          canvasHeight: height,
        } : null,
        materials,
      };
    });
    if (!metrics) throw new Error(`${name}: runtime unavailable`);
    if (metrics.buildId !== buildId) throw new Error(`${name}: wrong build ${metrics.buildId}`);
    if (metrics.state?.url !== defaultModel) throw new Error(`${name}: wrong default model ${metrics.state?.url}`);
    if (pageErrors.length) throw new Error(`${name}: page errors\n${pageErrors.join('\n')}`);
    const fatalRequests = requestFailures.filter(item => item.includes('.vrm') || item.includes('three'));
    if (fatalRequests.length) throw new Error(`${name}: fatal requests\n${fatalRequests.join('\n')}`);
    if (!Number.isFinite(metrics.averageLuma) || metrics.averageLuma < 55 || metrics.averageLuma > 205) {
      throw new Error(`${name}: invalid luma ${metrics.averageLuma}`);
    }
    if (metrics.count < 80_000) throw new Error(`${name}: too few avatar pixels ${metrics.count}`);
    validateBounds(name, metrics.bounds);

    if (name === 'idle') {
      const base = metrics.materials.filter(material => !material.name.includes('(Outline)'));
      const face = base.find(material => material.name.includes('Face_00_SKIN'));
      const body = base.find(material => material.name.includes('Body_00_SKIN'));
      const top = base.find(material => material.name.includes('Tops_01_CLOTH'));
      const hair = base.find(material => material.name.includes('_HAIR_01'));
      if (!face || Math.abs(face.emissiveIntensity - 0.08) > 0.011) throw new Error(`face tuning invalid ${JSON.stringify(face)}`);
      if (!body || Math.abs(body.emissiveIntensity - 0.08) > 0.011) throw new Error(`body tuning invalid ${JSON.stringify(body)}`);
      if (!top || top.color !== 'f4e9dc') throw new Error(`top tint invalid ${JSON.stringify(top)}`);
      if (!hair || hair.color !== 'ad8c83') throw new Error(`hair tint invalid ${JSON.stringify(hair)}`);
    }

    const full = await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true });
    const canvas = await page.locator('canvas').screenshot({ path: `${outputDir}/${name}-canvas.png` });
    results[name] = { ...metrics, fullHash: digest(full), canvasHash: digest(canvas), url: page.url() };
  } catch (error) {
    errors.push(error.stack || error.message);
    await page.screenshot({ path: `${outputDir}/${name}-failed.png`, fullPage: true }).catch(() => {});
  } finally {
    await page.close();
  }
}
await browser.close();

if (results.idle && results.wave && results.idle.canvasHash === results.wave.canvasHash) errors.push('idle and wave canvases are identical');
if (results.idle && results.closeup && results.idle.canvasHash === results.closeup.canvasHash) errors.push('idle and closeup canvases are identical');
await writeFile(`${outputDir}/results.json`, `${JSON.stringify({ buildId, defaultModel, results, errors }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ buildId, passed: Object.keys(results), errors }, null, 2));
if (errors.length) process.exitCode = 1;
