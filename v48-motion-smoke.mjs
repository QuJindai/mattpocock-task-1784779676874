import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.V48_URL || 'http://127.0.0.1:4173';
const out = process.env.V48_OUT || 'v48-liveliness-smoke';
const buildId = 'visual-avatar-a-v4-8-20260805';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [], pageErrors = [], requestFailures = [];
page.on('pageerror', error => pageErrors.push(error.stack || error.message));
page.on('requestfailed', request => requestFailures.push(`${request.url()} :: ${request.failure()?.errorText}`));

try {
  await page.goto(`${base}/?mode=capture&framing=standard&action=idle&emotion=relaxed&exposure=.68&scale=.98&fov=30`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(() => document.querySelector('#model-status')?.textContent === '角色已就绪', undefined, { timeout: 30_000 });

  const evidence = await page.evaluate(async expectedBuild => {
    const sample = () => {
      const lab = window.__vrmLab;
      const vrm = lab?.vrm;
      if (!lab || !vrm) return null;
      const bone = name => vrm.humanoid?.getNormalizedBoneNode(name);
      return {
        now: performance.now(),
        buildId: lab.buildId,
        v48: JSON.parse(JSON.stringify(lab.v48)),
        chestX: bone('chest')?.rotation.x ?? null,
        hipOffset: lab.v48?.motion?.hipOffset ?? null,
        leftShoulderZ: bone('leftShoulder')?.rotation.z ?? null,
        rightShoulderZ: bone('rightShoulder')?.rotation.z ?? null,
        headYaw: bone('head')?.rotation.y ?? null,
        headPitch: bone('head')?.rotation.x ?? null,
      };
    };

    const start = performance.now();
    const samples = [];
    let pointerStage = 0;
    while (performance.now() - start < 12_200) {
      const elapsed = performance.now() - start;
      if (pointerStage === 0 && elapsed >= 2100) {
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: 1480, clientY: 240, bubbles: true }));
        pointerStage = 1;
      } else if (pointerStage === 1 && elapsed >= 5900) {
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: 180, clientY: 560, bubbles: true }));
        pointerStage = 2;
      } else if (pointerStage === 2 && elapsed >= 9100) {
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: 800, clientY: 450, bubbles: true }));
        pointerStage = 3;
      }
      const value = sample();
      if (value) samples.push(value);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const last = sample();
    return {
      expectedBuild,
      wallMs: performance.now() - start,
      samples,
      last,
      pointerStages: pointerStage,
    };
  }, buildId);

  const values = key => evidence.samples.map(sample => sample[key]).filter(Number.isFinite);
  const reports = evidence.samples.map(sample => sample.v48);
  const reportValues = key => reports.map(report => report?.motion?.[key]).filter(Number.isFinite);
  const range = list => Math.max(...list) - Math.min(...list);
  const maxAbs = list => Math.max(...list.map(Math.abs));
  const maxStep = list => list.slice(1).reduce((max, value, index) => Math.max(max, Math.abs(value - list[index])), 0);
  const uniqueRounded = list => new Set(list.map(value => value.toFixed(3))).size;
  const firstFrames = reports[0]?.motion?.frameCount ?? 0;
  const lastFrames = reports.at(-1)?.motion?.frameCount ?? firstFrames;
  const frameDelta = lastFrames - firstFrames;
  const blinkValues = reports.map(report => report?.blink?.value).filter(Number.isFinite);
  const summary = {
    buildId: evidence.last?.buildId,
    wallMs: evidence.wallMs,
    sampleCount: evidence.samples.length,
    pointerStages: evidence.pointerStages,
    frameDelta,
    measuredFps: frameDelta / (evidence.wallMs / 1000),
    breathRange: range(reportValues('breath')),
    chestRange: range(values('chestX')),
    hipRange: range(values('hipOffset')),
    leftShoulderRange: range(values('leftShoulderZ')),
    rightShoulderRange: range(values('rightShoulderZ')),
    gazeRange: range(reportValues('gazeX')),
    gazeMaxStep: maxStep(reportValues('gazeX')),
    headYawRange: range(values('headYaw')),
    headYawMaxStep: maxStep(values('headYaw')),
    headPitchRange: range(values('headPitch')),
    chestMaxAbs: maxAbs(values('chestX')),
    hipMaxAbs: maxAbs(values('hipOffset')),
    leftShoulderMaxAbs: maxAbs(values('leftShoulderZ')),
    rightShoulderMaxAbs: maxAbs(values('rightShoulderZ')),
    blinkPeak: Math.max(...blinkValues),
    blinkCount: evidence.last?.v48?.blink?.count ?? 0,
    blinkHistory: evidence.last?.v48?.blink?.history ?? [],
    doubleCount: evidence.last?.v48?.blink?.doubleCount ?? 0,
    springAvailable: reports.every(report => report?.spring?.available === true),
  };

  if (summary.buildId !== buildId) errors.push(`wrong build ${summary.buildId}`);
  if (summary.sampleCount < 180 || summary.wallMs < 11_800 || summary.wallMs > 14_000) errors.push(`sampling duration ${JSON.stringify(summary)}`);
  if (summary.pointerStages !== 3) errors.push(`pointer stages ${summary.pointerStages}`);
  if (summary.frameDelta < 60 || summary.measuredFps < 5) errors.push(`animation frames ${JSON.stringify(summary)}`);
  if (summary.breathRange < 1.25 || summary.breathRange > 2.1) errors.push(`breath ${JSON.stringify(summary)}`);
  if (summary.chestRange < .012 || summary.chestRange > .04 || summary.chestMaxAbs > .032) errors.push(`chest ${JSON.stringify(summary)}`);
  if (summary.hipRange < .004 || summary.hipRange > .014 || summary.hipMaxAbs > .009) errors.push(`hips ${JSON.stringify(summary)}`);
  if (summary.leftShoulderRange < .006 || summary.leftShoulderRange > .025 || summary.leftShoulderMaxAbs > .022) errors.push(`left shoulder ${JSON.stringify(summary)}`);
  if (summary.rightShoulderRange < .005 || summary.rightShoulderRange > .023 || summary.rightShoulderMaxAbs > .022) errors.push(`right shoulder ${JSON.stringify(summary)}`);
  if (summary.gazeRange < .12 || summary.gazeRange > .30 || summary.gazeMaxStep > .035) errors.push(`gaze ${JSON.stringify(summary)}`);
  if (summary.headYawRange < .09 || summary.headYawRange > .30 || summary.headYawMaxStep > .035) errors.push(`head yaw ${JSON.stringify(summary)}`);
  if (summary.headPitchRange < .012 || summary.headPitchRange > .10) errors.push(`head pitch ${JSON.stringify(summary)}`);
  if (summary.blinkPeak < .65 || summary.blinkCount < 2 || summary.blinkCount > 6) errors.push(`blink ${JSON.stringify(summary)}`);
  if (summary.blinkHistory.length < 2 || uniqueRounded(summary.blinkHistory) < 2 || summary.blinkHistory.some(value => value < 2.2 || value > 5.4)) errors.push(`blink history ${JSON.stringify(summary.blinkHistory)}`);
  if (!summary.springAvailable) errors.push('SpringBone manager unavailable');
  if (pageErrors.length) errors.push(`page errors\n${pageErrors.join('\n')}`);
  const fatalRequests = requestFailures.filter(item => item.includes('.vrm') || item.includes('three') || item.includes('payload-'));
  if (fatalRequests.length) errors.push(`request failures\n${fatalRequests.join('\n')}`);

  await writeFile(`${out}/motion-timeseries.json`, `${JSON.stringify({ summary, evidence, pageErrors, requestFailures, errors }, null, 2)}\n`);
  console.log(JSON.stringify({ summary, errors }, null, 2));
} catch (error) {
  errors.push(error.stack || error.message);
  await page.screenshot({ path: `${out}/motion-failed.png`, fullPage: true }).catch(() => {});
  await writeFile(`${out}/motion-timeseries.json`, `${JSON.stringify({ errors, pageErrors, requestFailures }, null, 2)}\n`);
} finally {
  await page.close();
  await browser.close();
}

if (errors.length) process.exitCode = 1;
