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
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const results = {}, errors = [], digest = data => createHash('sha256').update(data).digest('hex');

function range(values) { return Math.max(...values) - Math.min(...values); }
function maxAbs(values) { return Math.max(...values.map(Math.abs)); }
function maxStep(values) { let m = 0; for (let i = 1; i < values.length; i++) m = Math.max(m, Math.abs(values[i] - values[i - 1])); return m; }
function uniqueRounded(values) { return new Set(values.map(v => v.toFixed(3))).size; }

function sampleRegion(buffer, region) {
  const png = PNG.sync.read(buffer);
  const x0 = Math.floor(region.x * png.width), y0 = Math.floor(region.y * png.height);
  const x1 = Math.ceil((region.x + region.w) * png.width), y1 = Math.ceil((region.y + region.h) * png.height);
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const i = (y * png.width + x) * 4; r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2]; n++;
  }
  return { r: r / n, g: g / n, b: b / n, luma: (.2126 * r + .7152 * g + .0722 * b) / n };
}

async function runtimeMetrics(page) {
  return page.evaluate(() => {
    const lab = window.__vrmLab, vrm = lab?.vrm, renderer = lab?.renderer, camera = lab?.camera, gl = renderer?.getContext?.(), canvas = renderer?.domElement;
    if (!lab || !vrm || !renderer || !camera || !gl || !canvas) return null;
    const h = vrm.humanoid, node = n => h?.getNormalizedBoneNode(n);
    const chest = node('chest'), hips = node('hips'), ls = node('leftShoulder'), rs = node('rightShoulder'), head = node('head');
    const width = canvas.width, height = canvas.height, pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let minX = width, maxX = -1, minY = height, maxY = -1, count = 0, luma = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4; if (pixels[i + 3] <= 24) continue;
      count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      luma += .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2];
    }
    const materials = [];
    const seen = new Set();
    vrm.scene.traverse(o => {
      if (!o.isMesh) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!m || seen.has(m.uuid)) continue; seen.add(m.uuid);
        materials.push({ name: m.name, color: m.color?.getHexString?.() ?? null, emissiveIntensity: m.emissiveIntensity ?? null });
      }
    });
    return {
      buildId: lab.buildId, state: lab.state, v47: lab.v47, v48: JSON.parse(JSON.stringify(lab.v48)),
      chestX: chest?.rotation.x ?? null, hipsY: hips?.position.y ?? null,
      leftShoulderZ: ls?.rotation.z ?? null, rightShoulderZ: rs?.rotation.z ?? null,
      headYaw: head?.rotation.y ?? null, headPitch: head?.rotation.x ?? null,
      bounds: count ? { minX, maxX, minY: height - 1 - maxY, maxY: height - 1 - minY, width: maxX - minX + 1, height: maxY - minY + 1, canvasWidth: width, canvasHeight: height, count } : null,
      averageLuma: count ? luma / count : null, materials,
    };
  });
}

async function openPage(query) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [], requestFailures = [];
  page.on('pageerror', e => pageErrors.push(e.stack || e.message));
  page.on('requestfailed', r => requestFailures.push(`${r.url()} :: ${r.failure()?.errorText}`));
  const started = Date.now();
  await page.goto(`${base}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(() => document.querySelector('#model-status')?.textContent === '角色已就绪', undefined, { timeout: 30_000 });
  return { page, readyMs: Date.now() - started, pageErrors, requestFailures };
}

async function capture(name, query) {
  const ctx = await openPage(query);
  try {
    await ctx.page.waitForTimeout(3200);
    const metrics = await runtimeMetrics(ctx.page);
    if (!metrics) throw new Error(`${name}: runtime metrics unavailable`);
    const full = await ctx.page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
    const canvas = await ctx.page.locator('canvas').screenshot({ path: `${out}/${name}-canvas.png` });
    results[name] = { ...metrics, readyMs: ctx.readyMs, fullHash: digest(full), canvasHash: digest(canvas), pageErrors: ctx.pageErrors, requestFailures: ctx.requestFailures };
    return full;
  } catch (error) {
    errors.push(error.stack || error.message);
    await ctx.page.screenshot({ path: `${out}/${name}-failed.png`, fullPage: true }).catch(() => {});
    return null;
  } finally { await ctx.page.close(); }
}

async function timeSeries() {
  const ctx = await openPage('mode=capture&framing=standard&action=idle&emotion=relaxed&exposure=.68&scale=.98&fov=30');
  const samples = [];
  try {
    for (let i = 0; i < 160; i++) {
      if (i === 28) await ctx.page.mouse.move(1480, 240);
      if (i === 78) await ctx.page.mouse.move(180, 560);
      if (i === 122) await ctx.page.mouse.move(800, 450);
      const m = await runtimeMetrics(ctx.page);
      if (!m) throw new Error(`timeseries sample ${i} unavailable`);
      samples.push({ i, atMs: i * 75, ...m });
      await ctx.page.waitForTimeout(75);
    }
    const values = key => samples.map(s => s[key]).filter(Number.isFinite);
    const breath = samples.map(s => s.v48?.motion?.breath).filter(Number.isFinite);
    const gaze = samples.map(s => s.v48?.motion?.gazeX).filter(Number.isFinite);
    const blink = samples.map(s => s.v48?.blink?.value).filter(Number.isFinite);
    const summary = {
      sampleCount: samples.length,
      frameDelta: (samples.at(-1).v48?.motion?.frameCount ?? 0) - (samples[0].v48?.motion?.frameCount ?? 0),
      breathRange: range(breath), chestRange: range(values('chestX')), hipRange: range(values('hipsY')),
      leftShoulderRange: range(values('leftShoulderZ')), rightShoulderRange: range(values('rightShoulderZ')),
      gazeRange: range(gaze), gazeMaxStep: maxStep(gaze), headYawRange: range(values('headYaw')), headYawMaxStep: maxStep(values('headYaw')),
      headPitchRange: range(values('headPitch')), blinkPeak: Math.max(...blink), blinkCount: samples.at(-1).v48?.blink?.count ?? 0,
      blinkHistory: samples.at(-1).v48?.blink?.history ?? [], doubleCount: samples.at(-1).v48?.blink?.doubleCount ?? 0,
      springAvailable: samples.every(s => s.v48?.spring?.available === true),
      chestMaxAbs: maxAbs(values('chestX')), hipMaxAbs: maxAbs(values('hipsY')),
      leftShoulderMaxAbs: maxAbs(values('leftShoulderZ')), rightShoulderMaxAbs: maxAbs(values('rightShoulderZ')),
    };
    results.timeSeries = summary;
    await writeFile(`${out}/timeseries.json`, `${JSON.stringify({ summary, samples }, null, 2)}\n`);

    if (summary.frameDelta < 400) errors.push(`timeseries: too few animation frames ${summary.frameDelta}`);
    if (summary.breathRange < 1.25 || summary.breathRange > 2.1) errors.push(`timeseries: breathRange ${summary.breathRange}`);
    if (summary.chestRange < .012 || summary.chestRange > .035 || summary.chestMaxAbs > .03) errors.push(`timeseries: chest ${JSON.stringify(summary)}`);
    if (summary.hipRange < .004 || summary.hipRange > .014 || summary.hipMaxAbs > .009) errors.push(`timeseries: hips ${JSON.stringify(summary)}`);
    if (summary.leftShoulderRange < .006 || summary.leftShoulderRange > .025 || summary.leftShoulderMaxAbs > .022) errors.push(`timeseries: left shoulder ${JSON.stringify(summary)}`);
    if (summary.rightShoulderRange < .005 || summary.rightShoulderRange > .023 || summary.rightShoulderMaxAbs > .022) errors.push(`timeseries: right shoulder ${JSON.stringify(summary)}`);
    if (summary.gazeRange < .12 || summary.gazeRange > .30 || summary.gazeMaxStep > .035) errors.push(`timeseries: gaze ${JSON.stringify(summary)}`);
    if (summary.headYawRange < .09 || summary.headYawRange > .30 || summary.headYawMaxStep > .035) errors.push(`timeseries: head yaw ${JSON.stringify(summary)}`);
    if (summary.headPitchRange < .012 || summary.headPitchRange > .10) errors.push(`timeseries: head pitch ${summary.headPitchRange}`);
    if (summary.blinkPeak < .72 || summary.blinkCount < 2) errors.push(`timeseries: blink ${JSON.stringify(summary)}`);
    if (summary.blinkHistory.length < 2 || uniqueRounded(summary.blinkHistory) < 2 || summary.blinkHistory.some(v => v < 2.2 || v > 5.4)) errors.push(`timeseries: blink history ${JSON.stringify(summary.blinkHistory)}`);
    if (!summary.springAvailable) errors.push('timeseries: SpringBone manager unavailable');
    if (ctx.pageErrors.length) errors.push(`timeseries page errors\n${ctx.pageErrors.join('\n')}`);
  } catch (error) {
    errors.push(error.stack || error.message);
    await ctx.page.screenshot({ path: `${out}/timeseries-failed.png`, fullPage: true }).catch(() => {});
  } finally { await ctx.page.close(); }
}

const idle = await capture('idle', 'mode=capture&framing=standard&action=idle&emotion=relaxed&exposure=.68&scale=.98&fov=30');
await capture('wave', 'mode=capture&framing=standard&action=wave&emotion=happy&exposure=.68&scale=.98&fov=30');
await capture('closeup', 'mode=capture&framing=closeup&action=idle&emotion=relaxed&exposure=.66&scale=.98&fov=30');
await timeSeries();
await browser.close();

for (const [name, r] of Object.entries(results).filter(([name]) => ['idle', 'wave', 'closeup'].includes(name))) {
  if (r.buildId !== buildId) errors.push(`${name}: wrong build ${r.buildId}`);
  if (r.readyMs > 30_000) errors.push(`${name}: ready SLA ${r.readyMs}`);
  if (!r.v48?.ready || r.v48?.version !== 'liveliness-v1') errors.push(`${name}: v48 report invalid`);
  if (!r.bounds || r.bounds.count < 80_000) errors.push(`${name}: avatar pixels invalid`);
  const top = r.bounds.minY / r.bounds.canvasHeight, height = r.bounds.height / r.bounds.canvasHeight;
  if (top < .05 || top > .30) errors.push(`${name}: top ratio ${top}`);
  if (height < .45 || height > (name === 'closeup' ? .98 : .93)) errors.push(`${name}: height ratio ${height}`);
  if (!Number.isFinite(r.averageLuma) || r.averageLuma < 55 || r.averageLuma > 205) errors.push(`${name}: luma ${r.averageLuma}`);
  if (r.pageErrors.length) errors.push(`${name}: page errors ${r.pageErrors.join('\n')}`);
  const fatal = r.requestFailures.filter(x => x.includes('.vrm') || x.includes('three') || x.includes('payload-'));
  if (fatal.length) errors.push(`${name}: requests ${fatal.join('\n')}`);
}

if (results.idle) {
  const mats = results.idle.v47?.materials ?? {};
  if (mats.skin?.color !== 'fff1ea' || Math.abs(mats.skin?.emissive - .045) > .006) errors.push(`idle: skin regression ${JSON.stringify(mats.skin)}`);
  if (mats.cardigan?.color !== 'd5eee6' || Math.abs(mats.cardigan?.emissive - .065) > .006) errors.push(`idle: cardigan regression ${JSON.stringify(mats.cardigan)}`);
  if (mats.hair?.color !== 'aa8178' || Math.abs(mats.hair?.emissive - .075) > .006) errors.push(`idle: hair regression ${JSON.stringify(mats.hair)}`);
  const warm = sampleRegion(idle, { x: .08, y: .16, w: .25, h: .48 }), cool = sampleRegion(idle, { x: .66, y: .10, w: .27, h: .42 });
  results.atmosphere = { warm, cool, warmRedBlue: warm.r - warm.b, coolBlueRed: cool.b - cool.r };
  if (warm.r - warm.b < 6) errors.push(`atmosphere warm ${JSON.stringify(warm)}`);
  if (cool.b - cool.r < 8) errors.push(`atmosphere cool ${JSON.stringify(cool)}`);
}

if (results.wave && results.wave.canvasHash === results.idle?.canvasHash) errors.push('idle and wave canvases identical');
if (results.closeup && results.idle) {
  const pixelRatio = results.closeup.bounds.count / results.idle.bounds.count;
  results.closeupComparison = { pixelRatio };
  if (pixelRatio < 1.12) errors.push(`closeup pixel ratio ${pixelRatio}`);
  if (results.closeup.canvasHash === results.idle.canvasHash) errors.push('idle and closeup canvases identical');
}

await writeFile(`${out}/results.json`, `${JSON.stringify({ buildId, results, errors }, null, 2)}\n`);
console.log(JSON.stringify({ buildId, passed: Object.keys(results), errors }, null, 2));
if (errors.length) process.exitCode = 1;
