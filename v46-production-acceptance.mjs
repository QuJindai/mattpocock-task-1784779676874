import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const baseUrl = process.env.VRM_URL || 'https://vrm-showcase-lab.vercel.app';
const outputDir = 'v46-production-acceptance';
const buildId = 'visual-avatar-a-v4-6-20260805';
const defaultModel = 'https://cdn.jsdelivr.net/gh/madjin/vrm-samples@master/vroid/stable/AvatarSample_A.vrm';
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const results = {};
const errors = [];
const digest = data => createHash('sha256').update(data).digest('hex');

function sampleRegion(buffer, region) {
  const png = PNG.sync.read(buffer);
  const x0 = Math.max(0, Math.floor(region.x * png.width));
  const y0 = Math.max(0, Math.floor(region.y * png.height));
  const x1 = Math.min(png.width, Math.ceil((region.x + region.w) * png.width));
  const y1 = Math.min(png.height, Math.ceil((region.y + region.h) * png.height));
  let r = 0, g = 0, b = 0, count = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * png.width + x) * 4;
      r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2]; count += 1;
    }
  }
  return {
    r: r / count,
    g: g / count,
    b: b / count,
    luma: (0.2126 * r + 0.7152 * g + 0.0722 * b) / count,
  };
}

function validateBounds(name, bounds) {
  if (!bounds) throw new Error(`${name}: avatar bounds unavailable`);
  const topRatio = bounds.minY / bounds.canvasHeight;
  const heightRatio = bounds.height / bounds.canvasHeight;
  const widthRatio = bounds.width / bounds.canvasWidth;
  const maxHeight = name === 'closeup' ? 0.98 : 0.93;
  if (topRatio < 0.05 || topRatio > 0.30) throw new Error(`${name}: invalid topRatio ${topRatio}`);
  if (heightRatio < 0.45 || heightRatio > maxHeight) throw new Error(`${name}: invalid heightRatio ${heightRatio}`);
  if (widthRatio < 0.14 || widthRatio > 0.78) throw new Error(`${name}: invalid widthRatio ${widthRatio}`);
}

async function capture(name, query) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  const requestFailures = [];
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  page.on('requestfailed', request => requestFailures.push(`${request.url()} :: ${request.failure()?.errorText}`));
  const started = Date.now();
  try {
    await page.goto(`${baseUrl}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => document.querySelector('#model-status')?.textContent === '角色已就绪', undefined, { timeout: 60_000 });
    const readyMs = Date.now() - started;
    await page.waitForTimeout(3_200);
    const metrics = await page.evaluate(() => {
      const lab = window.__vrmLab;
      const vrm = lab?.vrm;
      const renderer = lab?.renderer;
      const camera = lab?.camera;
      const gl = renderer?.getContext?.();
      const canvas = renderer?.domElement;
      if (!vrm || !camera || !gl || !canvas) return null;

      const width = canvas.width;
      const height = canvas.height;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let minX = width, maxX = -1, minYGl = height, maxYGl = -1, count = 0, luma = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          if (pixels[i + 3] <= 24) continue;
          count += 1;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minYGl = Math.min(minYGl, y); maxYGl = Math.max(maxYGl, y);
          luma += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
        }
      }

      camera.updateMatrixWorld(true);
      vrm.scene.updateMatrixWorld(true);
      const project = boneName => {
        const node = vrm.humanoid?.getNormalizedBoneNode(boneName);
        if (!node) return null;
        node.updateMatrixWorld(true);
        const m = node.matrixWorld.elements;
        const x = m[12], y = m[13], z = m[14];
        const view = camera.matrixWorldInverse.elements;
        const projection = camera.projectionMatrix.elements;
        const vx = view[0]*x + view[4]*y + view[8]*z + view[12];
        const vy = view[1]*x + view[5]*y + view[9]*z + view[13];
        const vz = view[2]*x + view[6]*y + view[10]*z + view[14];
        const vw = view[3]*x + view[7]*y + view[11]*z + view[15];
        const cx = projection[0]*vx + projection[4]*vy + projection[8]*vz + projection[12]*vw;
        const cy = projection[1]*vx + projection[5]*vy + projection[9]*vz + projection[13]*vw;
        const cw = projection[3]*vx + projection[7]*vy + projection[11]*vz + projection[15]*vw;
        const nx = cx/cw, ny = cy/cw;
        return { x: (nx + 1) * 0.5 * width, y: (1 - ny) * 0.5 * height };
      };

      const materials = [];
      const seen = new Set();
      vrm.scene.traverse(object => {
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
        buildId: lab.buildId ?? null,
        state: lab.state ?? null,
        width, height, count,
        averageLuma: count ? luma / count : null,
        bounds: count ? {
          minX, maxX,
          minY: height - 1 - maxYGl,
          maxY: height - 1 - minYGl,
          width: maxX - minX + 1,
          height: maxYGl - minYGl + 1,
          canvasWidth: width,
          canvasHeight: height,
        } : null,
        bones: {
          head: project('head'),
          hips: project('hips'),
          leftShoulder: project('leftUpperArm'),
          rightShoulder: project('rightUpperArm'),
          leftElbow: project('leftLowerArm'),
          leftHand: project('leftHand'),
        },
        materials,
      };
    });

    if (!metrics) throw new Error(`${name}: runtime metrics unavailable`);
    if (readyMs > 30_000) throw new Error(`${name}: model ready SLA exceeded ${readyMs}ms`);
    if (metrics.buildId !== buildId) throw new Error(`${name}: wrong build ${metrics.buildId}`);
    if (metrics.state?.url !== defaultModel) throw new Error(`${name}: wrong model ${metrics.state?.url}`);
    if (pageErrors.length) throw new Error(`${name}: page errors\n${pageErrors.join('\n')}`);
    const fatalRequests = requestFailures.filter(item => item.includes('.vrm') || item.includes('three') || item.includes('payload-'));
    if (fatalRequests.length) throw new Error(`${name}: fatal requests\n${fatalRequests.join('\n')}`);
    if (!Number.isFinite(metrics.averageLuma) || metrics.averageLuma < 55 || metrics.averageLuma > 205) throw new Error(`${name}: luma ${metrics.averageLuma}`);
    if (metrics.count < 80_000) throw new Error(`${name}: too few avatar pixels ${metrics.count}`);
    validateBounds(name, metrics.bounds);

    const full = await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true });
    const canvasImage = await page.locator('canvas').screenshot({ path: `${outputDir}/${name}-canvas.png` });
    results[name] = {
      ...metrics,
      readyMs,
      fullHash: digest(full),
      canvasHash: digest(canvasImage),
      pageErrors,
      requestFailures,
      url: page.url(),
    };
    return { full, metrics };
  } catch (error) {
    errors.push(error.stack || error.message);
    await page.screenshot({ path: `${outputDir}/${name}-failed.png`, fullPage: true }).catch(() => {});
    return null;
  } finally {
    await page.close();
  }
}

const idle = await capture('idle', 'mode=capture&framing=standard&action=idle&emotion=relaxed&distance=2.35&height=1.36&exposure=0.68&scale=0.98&fov=30&x=0');
const wave = await capture('wave', 'mode=capture&framing=standard&action=wave&emotion=happy&distance=2.35&height=1.36&exposure=0.68&scale=0.98&fov=30&x=0');
const closeup = await capture('closeup', 'mode=capture&framing=closeup&action=idle&emotion=relaxed&distance=2.35&height=1.36&exposure=0.66&scale=0.98&fov=30&x=0');
await browser.close();

if (results.idle) {
  const base = results.idle.materials.filter(material => !material.name.includes('(Outline)'));
  const face = base.find(material => material.name.includes('Face_00_SKIN'));
  const body = base.find(material => material.name.includes('Body_00_SKIN'));
  const top = base.find(material => material.name.includes('Tops_01_CLOTH'));
  const hair = base.find(material => material.name.includes('_HAIR_01'));
  if (!face || Math.abs(face.emissiveIntensity - 0.08) > 0.011 || face.color !== 'fff3ee') errors.push(`face tuning invalid ${JSON.stringify(face)}`);
  if (!body || Math.abs(body.emissiveIntensity - 0.08) > 0.011 || body.color !== 'fff3ee') errors.push(`body tuning invalid ${JSON.stringify(body)}`);
  if (!top || top.color !== 'f4e9dc' || Math.abs(top.emissiveIntensity - 0.10) > 0.011) errors.push(`top tuning invalid ${JSON.stringify(top)}`);
  if (!hair || hair.color !== 'ad8c83' || Math.abs(hair.emissiveIntensity - 0.12) > 0.011) errors.push(`hair tuning invalid ${JSON.stringify(hair)}`);
  const warm = sampleRegion(idle.full, { x: 0.08, y: 0.16, w: 0.25, h: 0.48 });
  const cool = sampleRegion(idle.full, { x: 0.66, y: 0.10, w: 0.27, h: 0.42 });
  results.atmosphere = { warm, cool, warmRedBlue: warm.r - warm.b, coolBlueRed: cool.b - cool.r };
  if (warm.r - warm.b < 6) errors.push(`warm region insufficient ${JSON.stringify(warm)}`);
  if (cool.b - cool.r < 8) errors.push(`cool region insufficient ${JSON.stringify(cool)}`);
}

if (results.wave) {
  const { head, leftShoulder, leftElbow, leftHand } = results.wave.bones;
  if (![head, leftShoulder, leftElbow, leftHand].every(Boolean)) errors.push('wave bones unavailable');
  else {
    const ax = leftShoulder.x - leftElbow.x, ay = leftShoulder.y - leftElbow.y;
    const bx = leftHand.x - leftElbow.x, by = leftHand.y - leftElbow.y;
    const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by);
    const cosine = Math.max(-1, Math.min(1, (ax*bx + ay*by) / denominator));
    const elbowAngle = Math.acos(cosine) * 180 / Math.PI;
    results.waveGesture = { elbowAngle, head, leftShoulder, leftElbow, leftHand };
    if (leftHand.x < results.wave.width * 0.55 || leftHand.x > results.wave.width * 0.90) errors.push(`wave hand x invalid ${leftHand.x}`);
    if (leftHand.y > head.y + results.wave.height * 0.12) errors.push(`wave hand too low ${leftHand.y}`);
    if (leftHand.y > leftElbow.y - results.wave.height * 0.02) errors.push(`wave hand not above elbow ${leftHand.y}`);
    if (!Number.isFinite(elbowAngle) || elbowAngle < 45 || elbowAngle > 125) errors.push(`wave elbow angle ${elbowAngle}`);
  }
}

if (results.idle && results.closeup) {
  const shoulderWidth = result => Math.abs(result.bones.rightShoulder.x - result.bones.leftShoulder.x);
  const torsoHeight = result => Math.abs(result.bones.hips.y - result.bones.head.y);
  const shoulderRatio = shoulderWidth(results.closeup) / shoulderWidth(results.idle);
  const torsoRatio = torsoHeight(results.closeup) / torsoHeight(results.idle);
  const pixelRatio = results.closeup.count / results.idle.count;
  results.closeupComparison = { shoulderRatio, torsoRatio, pixelRatio };
  if (shoulderRatio < 1.15 || shoulderRatio > 1.55) errors.push(`closeup shoulderRatio ${shoulderRatio}`);
  if (torsoRatio < 1.15 || torsoRatio > 1.55) errors.push(`closeup torsoRatio ${torsoRatio}`);
  if (pixelRatio < 1.12) errors.push(`closeup pixelRatio ${pixelRatio}`);
}

if (results.idle && results.wave && results.idle.canvasHash === results.wave.canvasHash) errors.push('idle and wave canvases identical');
if (results.idle && results.closeup && results.idle.canvasHash === results.closeup.canvasHash) errors.push('idle and closeup canvases identical');
await writeFile(`${outputDir}/results.json`, `${JSON.stringify({ buildId, defaultModel, results, errors }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ buildId, passed: Object.keys(results), errors }, null, 2));
if (errors.length) process.exitCode = 1;
