import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const base = process.env.V48_URL || 'http://127.0.0.1:4173';
const out = process.env.V48_OUT || 'v48-liveliness-smoke';
const buildId = 'visual-avatar-a-v4-8-20260805';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true,
  args: [
    '--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist',
    '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl',
  ],
});

const results = {};
const errors = [];
const digest = data => createHash('sha256').update(data).digest('hex');
const range = values => Math.max(...values) - Math.min(...values);
const maxAbs = values => Math.max(...values.map(Math.abs));
const maxStep = values => values.slice(1).reduce((m, value, i) => Math.max(m, Math.abs(value - values[i])), 0);
const uniqueRounded = values => new Set(values.map(value => value.toFixed(3))).size;

function sampleRegion(buffer, region) {
  const png = PNG.sync.read(buffer);
  const x0 = Math.floor(region.x * png.width);
  const y0 = Math.floor(region.y * png.height);
  const x1 = Math.ceil((region.x + region.w) * png.width);
  const y1 = Math.ceil((region.y + region.h) * png.height);
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * png.width + x) * 4;
      r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2]; n += 1;
    }
  }
  return { r: r / n, g: g / n, b: b / n, luma: (.2126 * r + .7152 * g + .0722 * b) / n };
}

async function openPage(query) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  const requestFailures = [];
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  page.on('requestfailed', request => requestFailures.push(`${request.url()} :: ${request.failure()?.errorText}`));
  const started = Date.now();
  await page.goto(`${base}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(
    () => document.querySelector('#model-status')?.textContent === '角色已就绪',
    undefined,
    { timeout: 30_000 },
  );
  return { page, readyMs: Date.now() - started, pageErrors, requestFailures };
}

async function motionMetrics(page) {
  return page.evaluate(() => {
    const lab = window.__vrmLab;
    const vrm = lab?.vrm;
    if (!lab || !vrm) return null;
    const humanoid = vrm.humanoid;
    const bone = name => humanoid?.getNormalizedBoneNode(name);
    return {
      buildId: lab.buildId,
      v48: JSON.parse(JSON.stringify(lab.v48)),
      chestX: bone('chest')?.rotation.x ?? null,
      hipsY: bone('hips')?.position.y ?? null,
      leftShoulderZ: bone('leftShoulder')?.rotation.z ?? null,
      rightShoulderZ: bone('rightShoulder')?.rotation.z ?? null,
      headYaw: bone('head')?.rotation.y ?? null,
      headPitch: bone('head')?.rotation.x ?? null,
    };
  });
}

async function visualMetrics(page) {
  return page.evaluate(() => {
    const lab = window.__vrmLab;
    const vrm = lab?.vrm;
    const renderer = lab?.renderer;
    const camera = lab?.camera;
    const gl = renderer?.getContext?.();
    const canvas = renderer?.domElement;
    if (!lab || !vrm || !renderer || !camera || !gl || !canvas) return null;

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
        luma += .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2];
      }
    }

    camera.updateMatrixWorld(true);
    vrm.scene.updateMatrixWorld(true);
    const project = name => {
      const object = vrm.humanoid?.getNormalizedBoneNode(name);
      if (!object) return null;
      object.updateMatrixWorld(true);
      const matrix = object.matrixWorld.elements;
      const x = matrix[12], y = matrix[13], z = matrix[14];
      const view = camera.matrixWorldInverse.elements;
      const projection = camera.projectionMatrix.elements;
      const vx = view[0] * x + view[4] * y + view[8] * z + view[12];
      const vy = view[1] * x + view[5] * y + view[9] * z + view[13];
      const vz = view[2] * x + view[6] * y + view[10] * z + view[14];
      const vw = view[3] * x + view[7] * y + view[11] * z + view[15];
      const cx = projection[0] * vx + projection[4] * vy + projection[8] * vz + projection[12] * vw;
      const cy = projection[1] * vx + projection[5] * vy + projection[9] * vz + projection[13] * vw;
      const cw = projection[3] * vx + projection[7] * vy + projection[11] * vz + projection[15] * vw;
      return { x: (cx / cw + 1) * .5 * width, y: (1 - cy / cw) * .5 * height };
    };

    return {
      buildId: lab.buildId,
      state: lab.state,
      v47: JSON.parse(JSON.stringify(lab.v47)),
      v48: JSON.parse(JSON.stringify(lab.v48)),
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
        count,
      } : null,
      bones: {
        head: project('head'), hips: project('hips'),
        leftShoulder: project('leftUpperArm'), rightShoulder: project('rightUpperArm'),
        leftElbow: project('leftLowerArm'), leftHand: project('leftHand'),
      },
    };
  });
}

async function capture(name, query) {
  const context = await openPage(query);
  try {
    await context.page.waitForTimeout(3200);
    const metrics = await visualMetrics(context.page);
    if (!metrics) throw new Error(`${name}: visual metrics unavailable`);
    const full = await context.page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
    const canvas = await context.page.locator('canvas').screenshot({ path: `${out}/${name}-canvas.png` });
    results[name] = {
      ...metrics,
      readyMs: context.readyMs,
      fullHash: digest(full),
      canvasHash: digest(canvas),
      pageErrors: context.pageErrors,
      requestFailures: context.requestFailures,
    };
    return full;
  } catch (error) {
    errors.push(error.stack || error.message);
    await context.page.screenshot({ path: `${out}/${name}-failed.png`, fullPage: true }).catch(() => {});
    return null;
  } finally {
    await context.page.close();
  }
}

async function timeSeries() {
  const context = await openPage('mode=capture&framing=standard&action=idle&emotion=relaxed&exposure=.68&scale=.98&fov=30');
  const samples = [];
  try {
    for (let i = 0; i < 160; i += 1) {
      if (i === 28) await context.page.mouse.move(1480, 240);
      if (i === 78) await context.page.mouse.move(180, 560);
      if (i === 122) await context.page.mouse.move(800, 450);
      const metrics = await motionMetrics(context.page);
      if (!metrics) throw new Error(`time-series sample ${i} unavailable`);
      samples.push({ i, atMs: i * 75, ...metrics });
      await context.page.waitForTimeout(75);
    }

    const values = key => samples.map(sample => sample[key]).filter(Number.isFinite);
    const breath = samples.map(sample => sample.v48?.motion?.breath).filter(Number.isFinite);
    const gaze = samples.map(sample => sample.v48?.motion?.gazeX).filter(Number.isFinite);
    const blink = samples.map(sample => sample.v48?.blink?.value).filter(Number.isFinite);
    const summary = {
      sampleCount: samples.length,
      frameDelta: (samples.at(-1).v48?.motion?.frameCount ?? 0) - (samples[0].v48?.motion?.frameCount ?? 0),
      breathRange: range(breath),
      chestRange: range(values('chestX')), hipRange: range(values('hipsY')),
      leftShoulderRange: range(values('leftShoulderZ')), rightShoulderRange: range(values('rightShoulderZ')),
      gazeRange: range(gaze), gazeMaxStep: maxStep(gaze),
      headYawRange: range(values('headYaw')), headYawMaxStep: maxStep(values('headYaw')),
      headPitchRange: range(values('headPitch')),
      blinkPeak: Math.max(...blink), blinkCount: samples.at(-1).v48?.blink?.count ?? 0,
      blinkHistory: samples.at(-1).v48?.blink?.history ?? [],
      doubleCount: samples.at(-1).v48?.blink?.doubleCount ?? 0,
      springAvailable: samples.every(sample => sample.v48?.spring?.available === true),
      chestMaxAbs: maxAbs(values('chestX')), hipMaxAbs: maxAbs(values('hipsY')),
      leftShoulderMaxAbs: maxAbs(values('leftShoulderZ')), rightShoulderMaxAbs: maxAbs(values('rightShoulderZ')),
    };
    results.timeSeries = summary;
    await writeFile(`${out}/timeseries.json`, `${JSON.stringify({ summary, samples }, null, 2)}\n`);

    if (summary.frameDelta < 400) errors.push(`time-series: too few animation frames ${summary.frameDelta}`);
    if (summary.breathRange < 1.25 || summary.breathRange > 2.1) errors.push(`time-series: breath range ${summary.breathRange}`);
    if (summary.chestRange < .012 || summary.chestRange > .035 || summary.chestMaxAbs > .03) errors.push(`time-series: chest ${JSON.stringify(summary)}`);
    if (summary.hipRange < .004 || summary.hipRange > .014 || summary.hipMaxAbs > .009) errors.push(`time-series: hips ${JSON.stringify(summary)}`);
    if (summary.leftShoulderRange < .006 || summary.leftShoulderRange > .025 || summary.leftShoulderMaxAbs > .022) errors.push(`time-series: left shoulder ${JSON.stringify(summary)}`);
    if (summary.rightShoulderRange < .005 || summary.rightShoulderRange > .023 || summary.rightShoulderMaxAbs > .022) errors.push(`time-series: right shoulder ${JSON.stringify(summary)}`);
    if (summary.gazeRange < .12 || summary.gazeRange > .30 || summary.gazeMaxStep > .035) errors.push(`time-series: gaze ${JSON.stringify(summary)}`);
    if (summary.headYawRange < .09 || summary.headYawRange > .30 || summary.headYawMaxStep > .035) errors.push(`time-series: head yaw ${JSON.stringify(summary)}`);
    if (summary.headPitchRange < .012 || summary.headPitchRange > .10) errors.push(`time-series: head pitch ${summary.headPitchRange}`);
    if (summary.blinkPeak < .72 || summary.blinkCount < 2) errors.push(`time-series: blink ${JSON.stringify(summary)}`);
    if (summary.blinkHistory.length < 2 || uniqueRounded(summary.blinkHistory) < 2 || summary.blinkHistory.some(value => value < 2.2 || value > 5.4)) errors.push(`time-series: blink history ${JSON.stringify(summary.blinkHistory)}`);
    if (!summary.springAvailable) errors.push('time-series: SpringBone manager unavailable');
    if (context.pageErrors.length) errors.push(`time-series: page errors\n${context.pageErrors.join('\n')}`);
  } catch (error) {
    errors.push(error.stack || error.message);
    await context.page.screenshot({ path: `${out}/timeseries-failed.png`, fullPage: true }).catch(() => {});
  } finally {
    await context.page.close();
  }
}

const idleImage = await capture('idle', 'mode=capture&framing=standard&action=idle&emotion=relaxed&exposure=.68&scale=.98&fov=30');
await capture('wave', 'mode=capture&framing=standard&action=wave&emotion=happy&exposure=.68&scale=.98&fov=30');
await capture('closeup', 'mode=capture&framing=closeup&action=idle&emotion=relaxed&exposure=.66&scale=.98&fov=30');
await timeSeries();
await browser.close();

for (const name of ['idle', 'wave', 'closeup']) {
  const result = results[name];
  if (!result) continue;
  if (result.buildId !== buildId) errors.push(`${name}: wrong build ${result.buildId}`);
  if (result.readyMs > 30_000) errors.push(`${name}: ready SLA ${result.readyMs}`);
  if (!result.v48?.ready || result.v48?.version !== 'liveliness-v1') errors.push(`${name}: V4.8 report invalid`);
  if (!result.bounds || result.bounds.count < 80_000) errors.push(`${name}: avatar pixels invalid`);
  const top = result.bounds.minY / result.bounds.canvasHeight;
  const height = result.bounds.height / result.bounds.canvasHeight;
  if (top < .05 || top > .30) errors.push(`${name}: top ratio ${top}`);
  if (height < .45 || height > (name === 'closeup' ? .98 : .93)) errors.push(`${name}: height ratio ${height}`);
  if (!Number.isFinite(result.averageLuma) || result.averageLuma < 55 || result.averageLuma > 205) errors.push(`${name}: luma ${result.averageLuma}`);
  if (result.pageErrors.length) errors.push(`${name}: page errors ${result.pageErrors.join('\n')}`);
  const fatal = result.requestFailures.filter(item => item.includes('.vrm') || item.includes('three') || item.includes('payload-'));
  if (fatal.length) errors.push(`${name}: request failures ${fatal.join('\n')}`);
}

if (results.idle) {
  const materials = results.idle.v47?.materials ?? {};
  if (materials.skin?.color !== 'fff1ea' || Math.abs(materials.skin?.emissive - .045) > .006) errors.push(`idle: skin regression ${JSON.stringify(materials.skin)}`);
  if (materials.cardigan?.color !== 'd5eee6' || Math.abs(materials.cardigan?.emissive - .065) > .006) errors.push(`idle: cardigan regression ${JSON.stringify(materials.cardigan)}`);
  if (materials.hair?.color !== 'aa8178' || Math.abs(materials.hair?.emissive - .075) > .006) errors.push(`idle: hair regression ${JSON.stringify(materials.hair)}`);
  const warm = sampleRegion(idleImage, { x: .08, y: .16, w: .25, h: .48 });
  const cool = sampleRegion(idleImage, { x: .66, y: .10, w: .27, h: .42 });
  results.atmosphere = { warm, cool, warmRedBlue: warm.r - warm.b, coolBlueRed: cool.b - cool.r };
  if (warm.r - warm.b < 6) errors.push(`atmosphere: warm ${JSON.stringify(warm)}`);
  if (cool.b - cool.r < 8) errors.push(`atmosphere: cool ${JSON.stringify(cool)}`);
}

if (results.wave) {
  const { head, leftShoulder, leftElbow, leftHand } = results.wave.bones;
  if (![head, leftShoulder, leftElbow, leftHand].every(Boolean)) errors.push('wave: projected bones unavailable');
  else {
    const ax = leftShoulder.x - leftElbow.x, ay = leftShoulder.y - leftElbow.y;
    const bx = leftHand.x - leftElbow.x, by = leftHand.y - leftElbow.y;
    const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by);
    const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / denominator));
    const elbowAngle = Math.acos(cosine) * 180 / Math.PI;
    results.waveGesture = { elbowAngle, head, leftShoulder, leftElbow, leftHand };
    if (elbowAngle < 45 || elbowAngle > 125) errors.push(`wave: elbow angle ${elbowAngle}`);
    if (leftHand.y > leftElbow.y - results.wave.height * .02) errors.push('wave: hand not above elbow');
  }
}

if (results.idle && results.wave && results.idle.canvasHash === results.wave.canvasHash) errors.push('idle and wave canvases identical');
if (results.idle && results.closeup) {
  const shoulder = result => Math.abs(result.bones.rightShoulder.x - result.bones.leftShoulder.x);
  const torso = result => Math.abs(result.bones.hips.y - result.bones.head.y);
  const shoulderRatio = shoulder(results.closeup) / shoulder(results.idle);
  const torsoRatio = torso(results.closeup) / torso(results.idle);
  const pixelRatio = results.closeup.bounds.count / results.idle.bounds.count;
  results.closeupComparison = { shoulderRatio, torsoRatio, pixelRatio };
  if (shoulderRatio < 1.15 || shoulderRatio > 1.55) errors.push(`closeup: shoulder ratio ${shoulderRatio}`);
  if (torsoRatio < 1.15 || torsoRatio > 1.55) errors.push(`closeup: torso ratio ${torsoRatio}`);
  if (pixelRatio < 1.12) errors.push(`closeup: pixel ratio ${pixelRatio}`);
  if (results.idle.canvasHash === results.closeup.canvasHash) errors.push('idle and closeup canvases identical');
}

await writeFile(`${out}/results.json`, `${JSON.stringify({ buildId, results, errors }, null, 2)}\n`);
console.log(JSON.stringify({ buildId, passed: Object.keys(results), errors }, null, 2));
if (errors.length) process.exitCode = 1;
