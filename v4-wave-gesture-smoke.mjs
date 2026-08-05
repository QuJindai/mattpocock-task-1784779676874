import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.VRM_URL || 'https://vrm-showcase-lab.vercel.app';
const outputDir = 'v4-wave-gesture-smoke';
const expectedBuild = 'visual-alicia-v4-1-20260805';
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});

const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.stack || error.message));

try {
  const query = new URLSearchParams({
    mode: 'capture',
    action: 'wave',
    emotion: 'happy',
    distance: '2.35',
    height: '1.36',
    exposure: '0.68',
    scale: '0.98',
    fov: '30',
    x: '0',
  });

  await page.goto(`${baseUrl}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(
    () => document.querySelector('#model-status')?.textContent === '角色已就绪',
    undefined,
    { timeout: 90_000 },
  );
  await page.waitForTimeout(3_200);

  const metrics = await page.evaluate(() => {
    const lab = window.__vrmLab;
    const vrm = lab?.vrm;
    const camera = lab?.camera;
    const renderer = lab?.renderer;
    if (!vrm || !camera || !renderer) return null;

    const width = renderer.domElement.width;
    const height = renderer.domElement.height;
    camera.updateMatrixWorld(true);
    vrm.scene.updateMatrixWorld(true);

    const project = name => {
      const node = vrm.humanoid?.getNormalizedBoneNode(name);
      if (!node) return null;
      const position = new THREE.Vector3();
      node.getWorldPosition(position);
      const world = position.toArray();
      position.project(camera);
      return {
        world,
        ndc: position.toArray(),
        x: (position.x + 1) * 0.5 * width,
        y: (1 - position.y) * 0.5 * height,
      };
    };

    const head = project('head');
    const shoulder = project('leftUpperArm');
    const elbow = project('leftLowerArm');
    const hand = project('leftHand');

    const elbowAngle = (() => {
      if (!shoulder || !elbow || !hand) return null;
      const ax = shoulder.x - elbow.x;
      const ay = shoulder.y - elbow.y;
      const bx = hand.x - elbow.x;
      const by = hand.y - elbow.y;
      const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by);
      if (!denominator) return null;
      const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / denominator));
      return Math.acos(cosine) * 180 / Math.PI;
    })();

    return {
      buildId: lab.buildId ?? null,
      state: lab.state ?? null,
      width,
      height,
      head,
      shoulder,
      elbow,
      hand,
      elbowAngle,
      normalized: head && elbow && hand ? {
        handToHeadX: (hand.x - head.x) / width,
        handToHeadY: (hand.y - head.y) / height,
        handAboveElbow: (elbow.y - hand.y) / height,
      } : null,
    };
  });

  if (!metrics) errors.push('gesture runtime metrics unavailable');
  else {
    if (metrics.buildId !== expectedBuild) {
      errors.push(`wrong build: expected ${expectedBuild}, got ${metrics.buildId}`);
    }
    const { head, shoulder, elbow, hand, elbowAngle, width, height, normalized } = metrics;
    if (![head, shoulder, elbow, hand].every(Boolean)) {
      errors.push(`required wave bones unavailable: ${JSON.stringify({ head, shoulder, elbow, hand })}`);
    } else {
      if (hand.x < width * 0.55 || hand.x > width * 0.90) {
        errors.push(`wave hand is not beside the head: x=${hand.x}, width=${width}`);
      }
      if (hand.y > head.y + height * 0.12) {
        errors.push(`wave hand is too far below the face: handY=${hand.y}, headY=${head.y}`);
      }
      if (hand.y > elbow.y - height * 0.02) {
        errors.push(`wave hand must be visibly above the elbow: handY=${hand.y}, elbowY=${elbow.y}`);
      }
      if (!Number.isFinite(elbowAngle) || elbowAngle < 45 || elbowAngle > 125) {
        errors.push(`wave elbow must be naturally bent: elbowAngle=${elbowAngle}`);
      }
      if (hand.y < height * 0.04 || hand.y > height * 0.88) {
        errors.push(`wave hand is outside the vertical safe region: handY=${hand.y}`);
      }
    }

    await writeFile(
      `${outputDir}/results.json`,
      `${JSON.stringify({ expectedBuild, metrics, errors }, null, 2)}\n`,
      'utf8',
    );
  }

  if (pageErrors.length) errors.push(`page errors:\n${pageErrors.join('\n')}`);
  await page.screenshot({ path: `${outputDir}/wave.png`, fullPage: true });
  await page.locator('canvas').screenshot({ path: `${outputDir}/wave-canvas.png` });
} catch (error) {
  errors.push(error.stack || error.message);
  await page.screenshot({ path: `${outputDir}/wave-failed.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

if (!(await import('node:fs/promises')).stat(`${outputDir}/results.json`).catch(() => null)) {
  await writeFile(`${outputDir}/results.json`, `${JSON.stringify({ expectedBuild, errors }, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({ expectedBuild, errors }, null, 2));
if (errors.length) process.exitCode = 1;
