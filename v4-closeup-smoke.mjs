import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.VRM_URL || 'https://vrm-showcase-lab.vercel.app';
const outputDir = 'v4-closeup-smoke';
const expectedBuild = 'visual-alicia-v4-3-20260805';
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});

const scenarios = {
  idle: 'mode=capture&framing=standard&action=idle&emotion=relaxed&distance=2.35&height=1.36&exposure=0.68&scale=0.98&fov=30&x=0',
  closeup: 'mode=capture&framing=closeup&action=idle&emotion=relaxed&distance=2.35&height=1.36&exposure=0.66&scale=0.98&fov=30&x=0',
};
const results = {};
const errors = [];

function projectBone(node, camera, width, height) {
  if (!node) return null;
  node.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const world = node.matrixWorld.elements;
  const x = world[12], y = world[13], z = world[14];
  const view = camera.matrixWorldInverse.elements;
  const projection = camera.projectionMatrix.elements;
  const vx = view[0] * x + view[4] * y + view[8] * z + view[12];
  const vy = view[1] * x + view[5] * y + view[9] * z + view[13];
  const vz = view[2] * x + view[6] * y + view[10] * z + view[14];
  const vw = view[3] * x + view[7] * y + view[11] * z + view[15];
  const cx = projection[0] * vx + projection[4] * vy + projection[8] * vz + projection[12] * vw;
  const cy = projection[1] * vx + projection[5] * vy + projection[9] * vz + projection[13] * vw;
  const cw = projection[3] * vx + projection[7] * vy + projection[11] * vz + projection[15] * vw;
  const nx = cx / cw, ny = cy / cw;
  return { x: (nx + 1) * 0.5 * width, y: (1 - ny) * 0.5 * height, ndc: [nx, ny] };
}

async function capture(name, query) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.goto(`${baseUrl}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(
      () => document.querySelector('#model-status')?.textContent === '角色已就绪',
      undefined,
      { timeout: 90_000 },
    );
    await page.waitForTimeout(3_200);

    const metrics = await page.evaluate(() => {
      const lab = window.__vrmLab;
      const gl = lab?.renderer?.getContext?.();
      const canvas = lab?.renderer?.domElement;
      const camera = lab?.camera;
      const humanoid = lab?.vrm?.humanoid;
      if (!lab?.vrm || !gl || !canvas || !camera || !humanoid) return null;
      const width = canvas.width;
      const height = canvas.height;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let minX = width, maxX = -1, minYGl = height, maxYGl = -1, count = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (pixels[(y * width + x) * 4 + 3] <= 24) continue;
          count += 1;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minYGl = Math.min(minYGl, y);
          maxYGl = Math.max(maxYGl, y);
        }
      }

      const project = name => {
        const node = humanoid.getNormalizedBoneNode(name);
        if (!node) return null;
        node.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);
        const world = node.matrixWorld.elements;
        const x = world[12], y = world[13], z = world[14];
        const view = camera.matrixWorldInverse.elements;
        const projection = camera.projectionMatrix.elements;
        const vx = view[0] * x + view[4] * y + view[8] * z + view[12];
        const vy = view[1] * x + view[5] * y + view[9] * z + view[13];
        const vz = view[2] * x + view[6] * y + view[10] * z + view[14];
        const vw = view[3] * x + view[7] * y + view[11] * z + view[15];
        const cx = projection[0] * vx + projection[4] * vy + projection[8] * vz + projection[12] * vw;
        const cy = projection[1] * vx + projection[5] * vy + projection[9] * vz + projection[13] * vw;
        const cw = projection[3] * vx + projection[7] * vy + projection[11] * vz + projection[15] * vw;
        const nx = cx / cw, ny = cy / cw;
        return { x: (nx + 1) * 0.5 * width, y: (1 - ny) * 0.5 * height };
      };

      const leftShoulder = project('leftUpperArm');
      const rightShoulder = project('rightUpperArm');
      const head = project('head');
      const hips = project('hips');
      return {
        buildId: lab.buildId ?? null,
        state: lab.state ?? null,
        shoulderSpan: leftShoulder && rightShoulder ? Math.abs(rightShoulder.x - leftShoulder.x) : null,
        headToHips: head && hips ? Math.abs(hips.y - head.y) : null,
        bones: { leftShoulder, rightShoulder, head, hips },
        bounds: count ? {
          minX,
          maxX,
          minY: height - 1 - maxYGl,
          maxY: height - 1 - minYGl,
          width: maxX - minX + 1,
          height: maxYGl - minYGl + 1,
          canvasWidth: width,
          canvasHeight: height,
          count,
        } : null,
      };
    });

    if (!metrics) throw new Error(`${name}: metrics unavailable`);
    if (metrics.buildId !== expectedBuild) throw new Error(`${name}: wrong build ${metrics.buildId}`);
    if (!metrics.bounds || !Number.isFinite(metrics.shoulderSpan) || !Number.isFinite(metrics.headToHips)) {
      throw new Error(`${name}: closeup metrics incomplete`);
    }
    await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true });
    await page.locator('canvas').screenshot({ path: `${outputDir}/${name}-canvas.png` });
    results[name] = metrics;
  } catch (error) {
    errors.push(error.stack || error.message);
    await page.screenshot({ path: `${outputDir}/${name}-failed.png`, fullPage: true }).catch(() => {});
  } finally {
    await page.close();
  }
}

for (const [name, query] of Object.entries(scenarios)) await capture(name, query);
await browser.close();

if (results.idle && results.closeup) {
  const shoulderRatio = results.closeup.shoulderSpan / results.idle.shoulderSpan;
  const torsoRatio = results.closeup.headToHips / results.idle.headToHips;
  const topRatio = results.closeup.bounds.minY / results.closeup.bounds.canvasHeight;
  const pixelRatio = results.closeup.bounds.count / results.idle.bounds.count;
  results.comparison = { shoulderRatio, torsoRatio, topRatio, pixelRatio };

  if (results.idle.state?.framing !== 'standard') {
    errors.push(`idle framing state must be standard: ${results.idle.state?.framing}`);
  }
  if (results.closeup.state?.framing !== 'closeup') {
    errors.push(`closeup framing state must be closeup: ${results.closeup.state?.framing}`);
  }
  if (shoulderRatio < 1.15 || shoulderRatio > 1.55) {
    errors.push(`closeup shoulder magnification must be 15%-55%: shoulderRatio=${shoulderRatio}`);
  }
  if (torsoRatio < 1.15 || torsoRatio > 1.55) {
    errors.push(`closeup torso magnification must be 15%-55%: torsoRatio=${torsoRatio}`);
  }
  if (topRatio < 0.04 || topRatio > 0.20) {
    errors.push(`closeup top safe area invalid: topRatio=${topRatio}`);
  }
  if (pixelRatio < 0.82) {
    errors.push(`closeup retained too few visible avatar pixels: pixelRatio=${pixelRatio}`);
  }
}

await writeFile(
  `${outputDir}/results.json`,
  `${JSON.stringify({ expectedBuild, results, errors }, null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify({ expectedBuild, comparison: results.comparison, errors }, null, 2));
if (errors.length) process.exitCode = 1;
