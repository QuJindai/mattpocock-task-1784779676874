import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.V48_URL || 'http://127.0.0.1:4173';
const out = process.env.V48_OUT || 'v48-motion-deterministic';
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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [], pageErrors = [], requestFailures = [];
page.on('pageerror', error => pageErrors.push(error.stack || error.message));
page.on('requestfailed', request => requestFailures.push(`${request.url()} :: ${request.failure()?.errorText}`));

const range = values => Math.max(...values) - Math.min(...values);
const maxAbs = values => Math.max(...values.map(Math.abs));
const maxStep = values => values.slice(1).reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - values[index])), 0);
const uniqueRounded = values => new Set(values.map(value => value.toFixed(3))).size;

try {
  await page.goto(`${base}/?mode=capture&framing=standard&action=idle&emotion=relaxed&exposure=.68&scale=.98&fov=30`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(() => document.querySelector('#model-status')?.textContent === '角色已就绪', undefined, { timeout: 30_000 });

  const evidence = await page.evaluate(expectedBuild => {
    const lab = window.__vrmLab;
    if (!lab?.vrm || typeof lab.stepV48 !== 'function' || typeof lab.resetV48 !== 'function' || typeof lab.setV48Pointer !== 'function') {
      throw new Error('V4.8 deterministic runtime interface unavailable');
    }
    if (lab.buildId !== expectedBuild) throw new Error(`wrong build ${lab.buildId}`);

    const vrm = lab.vrm;
    const bone = name => vrm.humanoid?.getNormalizedBoneNode(name);
    lab.setV48Pointer(0, 0, -999);
    lab.resetV48(0);

    const samples = [];
    const fps = 60;
    const duration = 15;
    const totalFrames = duration * fps;
    for (let frame = 0; frame <= totalFrames; frame += 1) {
      const t = frame / fps;
      if (frame === Math.round(2.1 * fps)) lab.setV48Pointer(.85, .4667, t);
      if (frame === Math.round(5.9 * fps)) lab.setV48Pointer(-.775, -.2444, t);
      if (frame === Math.round(9.1 * fps)) lab.setV48Pointer(0, 0, t);
      lab.stepV48(t, 1 / fps);
      const report = JSON.parse(JSON.stringify(lab.v48));
      samples.push({
        frame, t,
        report,
        chestX: bone('chest')?.rotation.x ?? null,
        hipOffset: report.motion?.hipOffset ?? null,
        leftShoulderZ: bone('leftShoulder')?.rotation.z ?? null,
        rightShoulderZ: bone('rightShoulder')?.rotation.z ?? null,
        headYaw: bone('head')?.rotation.y ?? null,
        headPitch: bone('head')?.rotation.x ?? null,
      });
    }
    return {
      buildId: lab.buildId,
      state: JSON.parse(JSON.stringify(lab.state)),
      samples,
      finalReport: JSON.parse(JSON.stringify(lab.v48)),
      interfaces: {
        step: typeof lab.stepV48,
        reset: typeof lab.resetV48,
        pointer: typeof lab.setV48Pointer,
      },
    };
  }, buildId);

  const values = key => evidence.samples.map(sample => sample[key]).filter(Number.isFinite);
  const reportValues = key => evidence.samples.map(sample => sample.report?.motion?.[key]).filter(Number.isFinite);
  const blinkValues = evidence.samples.map(sample => sample.report?.blink?.value).filter(Number.isFinite);
  const summary = {
    buildId: evidence.buildId,
    sampleCount: evidence.samples.length,
    frameDelta: (evidence.samples.at(-1).report?.motion?.frameCount ?? 0) - (evidence.samples[0].report?.motion?.frameCount ?? 0),
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
    blinkCount: evidence.finalReport?.blink?.count ?? 0,
    blinkHistory: evidence.finalReport?.blink?.history ?? [],
    doubleCount: evidence.finalReport?.blink?.doubleCount ?? 0,
    springAvailable: evidence.samples.every(sample => sample.report?.spring?.available === true),
  };

  if (summary.buildId !== buildId) errors.push(`wrong build ${summary.buildId}`);
  if (summary.sampleCount !== 901 || summary.frameDelta !== 900) errors.push(`frame contract ${JSON.stringify(summary)}`);
  if (summary.breathRange < 1.5 || summary.breathRange > 2.1) errors.push(`breath ${JSON.stringify(summary)}`);
  if (summary.chestRange < .018 || summary.chestRange > .035 || summary.chestMaxAbs > .032) errors.push(`chest ${JSON.stringify(summary)}`);
  if (summary.hipRange < .006 || summary.hipRange > .012 || summary.hipMaxAbs > .007) errors.push(`hips ${JSON.stringify(summary)}`);
  if (summary.leftShoulderRange < .009 || summary.leftShoulderRange > .024 || summary.leftShoulderMaxAbs > .022) errors.push(`left shoulder ${JSON.stringify(summary)}`);
  if (summary.rightShoulderRange < .007 || summary.rightShoulderRange > .022 || summary.rightShoulderMaxAbs > .022) errors.push(`right shoulder ${JSON.stringify(summary)}`);
  if (summary.gazeRange < .17 || summary.gazeRange > .27 || summary.gazeMaxStep > .025) errors.push(`gaze ${JSON.stringify(summary)}`);
  if (summary.headYawRange < .16 || summary.headYawRange > .28 || summary.headYawMaxStep > .03) errors.push(`head yaw ${JSON.stringify(summary)}`);
  if (summary.headPitchRange < .028 || summary.headPitchRange > .075) errors.push(`head pitch ${JSON.stringify(summary)}`);
  if (summary.blinkPeak < .78 || summary.blinkCount < 5 || summary.blinkCount > 6) errors.push(`blink ${JSON.stringify(summary)}`);
  if (summary.doubleCount < 1) errors.push(`double blink ${JSON.stringify(summary)}`);
  if (summary.blinkHistory.length < 4 || uniqueRounded(summary.blinkHistory) < 3 || summary.blinkHistory.some(value => value < 2.2 || value > 5.4)) errors.push(`blink history ${JSON.stringify(summary.blinkHistory)}`);
  if (!summary.springAvailable) errors.push('SpringBone manager unavailable');
  if (pageErrors.length) errors.push(`page errors\n${pageErrors.join('\n')}`);
  const fatalRequests = requestFailures.filter(item => item.includes('.vrm') || item.includes('three') || item.includes('payload-'));
  if (fatalRequests.length) errors.push(`request failures\n${fatalRequests.join('\n')}`);

  await writeFile(`${out}/deterministic-timeseries.json`, `${JSON.stringify({ summary, evidence, pageErrors, requestFailures, errors }, null, 2)}\n`);
  await page.screenshot({ path: `${out}/final-frame.png`, fullPage: true });
  console.log(JSON.stringify({ summary, errors }, null, 2));
} catch (error) {
  errors.push(error.stack || error.message);
  await page.screenshot({ path: `${out}/failed.png`, fullPage: true }).catch(() => {});
  await writeFile(`${out}/deterministic-timeseries.json`, `${JSON.stringify({ errors, pageErrors, requestFailures }, null, 2)}\n`);
} finally {
  await page.close();
  await browser.close();
}

if (errors.length) process.exitCode = 1;
