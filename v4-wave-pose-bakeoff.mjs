import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.VRM_URL || 'https://vrm-showcase-lab.vercel.app';
const outputDir = 'v4-wave-pose-bakeoff';
const expectedBuild = 'visual-alicia-v4-1-20260805';
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

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

const buildId = await page.evaluate(() => window.__vrmLab?.buildId ?? null);
if (buildId !== expectedBuild) throw new Error(`Expected ${expectedBuild}, got ${buildId}`);

await page.evaluate(() => {
  const lab = window.__vrmLab;
  const vrm = lab.vrm;
  const originalUpdate = vrm.update.bind(vrm);
  vrm.update = dt => {
    originalUpdate(dt);
    const pose = window.__wavePoseOverride;
    if (!pose) return;
    const upper = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
    const lower = vrm.humanoid?.getNormalizedBoneNode('leftLowerArm');
    if (upper) upper.rotation.set(...pose.upper);
    if (lower) lower.rotation.set(...pose.lower);
  };
});

const projectMetrics = () => page.evaluate(() => {
  const lab = window.__vrmLab;
  const { vrm, camera, renderer } = lab;
  const width = renderer.domElement.width;
  const height = renderer.domElement.height;
  camera.updateMatrixWorld(true);
  vrm.scene.updateMatrixWorld(true);

  const project = name => {
    const node = vrm.humanoid?.getNormalizedBoneNode(name);
    if (!node) return null;
    node.updateMatrixWorld(true);
    const worldMatrix = node.matrixWorld.elements;
    const x = worldMatrix[12];
    const y = worldMatrix[13];
    const z = worldMatrix[14];
    const view = camera.matrixWorldInverse.elements;
    const projection = camera.projectionMatrix.elements;
    const vx = view[0] * x + view[4] * y + view[8] * z + view[12];
    const vy = view[1] * x + view[5] * y + view[9] * z + view[13];
    const vz = view[2] * x + view[6] * y + view[10] * z + view[14];
    const vw = view[3] * x + view[7] * y + view[11] * z + view[15];
    const cx = projection[0] * vx + projection[4] * vy + projection[8] * vz + projection[12] * vw;
    const cy = projection[1] * vx + projection[5] * vy + projection[9] * vz + projection[13] * vw;
    const cz = projection[2] * vx + projection[6] * vy + projection[10] * vz + projection[14] * vw;
    const cw = projection[3] * vx + projection[7] * vy + projection[11] * vz + projection[15] * vw;
    const ndcX = cx / cw;
    const ndcY = cy / cw;
    return {
      world: [x, y, z],
      ndc: [ndcX, ndcY, cz / cw],
      x: (ndcX + 1) * 0.5 * width,
      y: (1 - ndcY) * 0.5 * height,
    };
  };

  const head = project('head');
  const shoulder = project('leftUpperArm');
  const elbow = project('leftLowerArm');
  const hand = project('leftHand');
  if (![head, shoulder, elbow, hand].every(Boolean)) return null;

  const ax = shoulder.x - elbow.x;
  const ay = shoulder.y - elbow.y;
  const bx = hand.x - elbow.x;
  const by = hand.y - elbow.y;
  const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by);
  const cosine = denominator ? Math.max(-1, Math.min(1, (ax * bx + ay * by) / denominator)) : NaN;
  const elbowAngle = Math.acos(cosine) * 180 / Math.PI;

  return {
    width,
    height,
    head,
    shoulder,
    elbow,
    hand,
    elbowAngle,
    normalized: {
      handToHeadX: (hand.x - head.x) / width,
      handToHeadY: (hand.y - head.y) / height,
      handAboveElbow: (elbow.y - hand.y) / height,
    },
  };
});

const upperX = [-1.25, -1.05, -0.85, -0.65, -0.45, -0.25];
const upperY = [-0.15, 0.05, 0.25];
const upperZ = [-0.15, 0.05, 0.25, 0.45, 0.65];
const lowerX = [-1.9, -1.55, -1.2, -0.85, -0.5];
const lowerY = [-0.15, 0.1, 0.35];
const lowerZ = [0.55, 0.9, 1.25, 1.6];

// Coarse-to-fine search: sample a deterministic subset instead of the full Cartesian product.
const candidates = [];
for (const ux of upperX) {
  for (const uy of upperY) {
    for (const uz of upperZ) {
      for (const lx of lowerX) {
        for (const ly of lowerY) {
          for (const lz of lowerZ) {
            const signature = Math.round((ux * 31 + uy * 37 + uz * 41 + lx * 43 + ly * 47 + lz * 53) * 1000);
            if (Math.abs(signature) % 17 === 0) {
              candidates.push({ upper: [ux, uy, uz], lower: [lx, ly, lz] });
            }
          }
        }
      }
    }
  }
}

const evaluated = [];
for (const pose of candidates) {
  await page.evaluate(value => { window.__wavePoseOverride = value; }, pose);
  await page.waitForTimeout(55);
  const metrics = await projectMetrics();
  if (!metrics || !Number.isFinite(metrics.elbowAngle)) continue;

  const { handToHeadX, handToHeadY, handAboveElbow } = metrics.normalized;
  const score =
    Math.abs(handToHeadX - 0.16) * 2.5 +
    Math.abs(handToHeadY - 0.035) * 5.0 +
    Math.abs(metrics.elbowAngle - 88) / 90 +
    Math.max(0, 0.025 - handAboveElbow) * 8 +
    Math.max(0, -handToHeadX) * 5 +
    Math.max(0, handToHeadX - 0.32) * 5;

  const passesGate =
    handToHeadX >= 0.08 && handToHeadX <= 0.32 &&
    handToHeadY <= 0.12 &&
    handAboveElbow >= 0.02 &&
    metrics.elbowAngle >= 45 && metrics.elbowAngle <= 125 &&
    metrics.hand.y >= metrics.height * 0.04 && metrics.hand.y <= metrics.height * 0.88;

  evaluated.push({ pose, metrics, score, passesGate });
}

evaluated.sort((a, b) => a.score - b.score);
const finalists = evaluated.slice(0, 6);

for (let index = 0; index < finalists.length; index += 1) {
  const finalist = finalists[index];
  await page.evaluate(value => { window.__wavePoseOverride = value; }, finalist.pose);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${outputDir}/${String(index + 1).padStart(2, '0')}-candidate.png`, fullPage: true });
  await page.locator('canvas').screenshot({ path: `${outputDir}/${String(index + 1).padStart(2, '0')}-candidate-canvas.png` });
}

await writeFile(
  `${outputDir}/results.json`,
  `${JSON.stringify({ expectedBuild, candidateCount: candidates.length, passingCount: evaluated.filter(x => x.passesGate).length, finalists, top20: evaluated.slice(0, 20) }, null, 2)}\n`,
  'utf8',
);

await browser.close();

console.log(JSON.stringify({ candidateCount: candidates.length, passingCount: evaluated.filter(x => x.passesGate).length, best: finalists[0] ?? null }, null, 2));
if (!finalists.some(item => item.passesGate)) process.exitCode = 1;
