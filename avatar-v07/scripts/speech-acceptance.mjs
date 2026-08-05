import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = (process.env.AVATAR_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const outputDir = 'avatar-v08-speech-artifacts';
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const results = { status: 'fail', baseUrl };
const logs = [];
const fatalErrors = [];
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function attachDiagnostics(page, label) {
  page.on('console', (message) => logs.push(`[${label}][console:${message.type()}] ${message.text()}`));
  page.on('pageerror', (error) => {
    const text = error.stack || error.message;
    fatalErrors.push(`[${label}][pageerror] ${text}`);
    logs.push(`[${label}][pageerror] ${text}`);
  });
  page.on('requestfailed', (request) => {
    const text = `${request.resourceType()} ${request.url()} :: ${request.failure()?.errorText}`;
    logs.push(`[${label}][requestfailed] ${text}`);
    if (['document', 'script', 'fetch', 'xhr', 'image'].includes(request.resourceType())) fatalErrors.push(text);
  });
}

async function installSpeechMock(context) {
  await context.addInitScript(() => {
    const trace = [];
    const timers = new Set();
    const listeners = new Map();
    const voices = [
      { name: 'Chinese Local', lang: 'zh-CN', voiceURI: 'zh-local', localService: true, default: true },
      { name: 'Chinese Alternate', lang: 'zh-TW', voiceURI: 'zh-alt', localService: false, default: false },
    ];

    class MockUtterance {
      constructor(text) {
        this.text = text;
        this.lang = '';
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.voice = null;
        this.onstart = null;
        this.onboundary = null;
        this.onend = null;
        this.onerror = null;
      }
    }

    function schedule(callback, delay) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        callback();
      }, delay);
      timers.add(timer);
    }

    const synthesis = {
      speaking: false,
      pending: false,
      paused: false,
      getVoices() { return voices; },
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type) { listeners.delete(type); },
      speak(utterance) {
        this.speaking = true;
        trace.push({
          type: 'speak',
          text: utterance.text,
          lang: utterance.lang,
          rate: utterance.rate,
          pitch: utterance.pitch,
          volume: utterance.volume,
          voice: utterance.voice?.voiceURI || '',
        });
        schedule(() => utterance.onstart?.({ type: 'start' }), 20);
        const indices = [0, 1, 2].filter((index) => index < utterance.text.length);
        indices.forEach((charIndex, index) => {
          schedule(() => {
            trace.push({ type: 'boundary', charIndex, char: utterance.text[charIndex] });
            utterance.onboundary?.({ type: 'boundary', charIndex, name: 'word', elapsedTime: (index + 1) * 0.18 });
          }, 120 + index * 180);
        });
        if (!utterance.text.includes('[hold]')) {
          schedule(() => {
            this.speaking = false;
            trace.push({ type: 'end' });
            utterance.onend?.({ type: 'end' });
          }, 2200);
        }
      },
      cancel() {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        this.speaking = false;
        trace.push({ type: 'cancel' });
      },
    };

    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: MockUtterance });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis });
    window.__speechMock = { trace, voices, synthesis };
  });
}

async function installUnsupportedSpeech(context) {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: undefined });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined });
  });
}

async function waitReady(page) {
  await page.waitForSelector('canvas.stage', { timeout: 120_000 });
  await page.waitForFunction(() => window.__avatarLab?.ready === true, undefined, { timeout: 120_000 });
}

async function screenshot(page, name) {
  const buffer = await page.screenshot({ path: `${outputDir}/${name}`, fullPage: true });
  if (buffer.length < 100_000) throw new Error(`${name} is unexpectedly small: ${buffer.length}`);
  return { bytes: buffer.length, sha256: sha256(buffer) };
}

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await installSpeechMock(context);
  const page = await context.newPage();
  attachDiagnostics(page, 'speech');
  const studioUrl = `${baseUrl}/studio?autoplay=0&state=idle&expression=neutral&voice=zh-local&rate=1.25&pitch=1.1&volume=0.7`;
  await page.goto(studioUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitReady(page);

  const initial = await page.evaluate(() => ({
    supported: window.__avatarLab.speech.supported,
    voices: window.__avatarLab.speech.voices,
    capabilities: window.__avatarLab.capabilities,
    state: window.__avatarLab.state,
    playDisabled: document.querySelector('#speech-play').disabled,
    voiceValue: document.querySelector('#speech-voice').value,
  }));
  if (!initial.supported) throw new Error('mock browser speech was not detected');
  if (initial.voices.length !== 2) throw new Error(`expected 2 voices, got ${initial.voices.length}`);
  if (!initial.capabilities.speech || initial.capabilities.lipSync !== 'amplitude') throw new Error('renderer speech capabilities are incorrect');
  if (initial.playDisabled) throw new Error('speech play button is disabled in a supported browser');
  if (initial.voiceValue !== 'zh-local') throw new Error(`voice URL state was not restored: ${initial.voiceValue}`);
  if (initial.state.rate !== 1.25 || initial.state.pitch !== 1.1 || initial.state.volume !== 0.7) {
    throw new Error(`speech URL settings were not restored: ${JSON.stringify(initial.state)}`);
  }
  results.initial = initial;

  await page.locator('#speech-text').fill('啊你好');
  await page.locator('#speech-play').click();
  await page.waitForFunction(() => window.__avatarLab?.diagnostics?.controller?.state === 'talk', undefined, { timeout: 10_000 });

  const lipValues = new Set();
  const mouthFrames = new Set();
  const samples = [];
  const sampleStarted = Date.now();
  while (Date.now() - sampleStarted < 900) {
    const sample = await page.evaluate(() => ({
      lip: window.__avatarLab?.diagnostics?.controller?.lipSync,
      frame: window.__avatarLab?.diagnostics?.controller?.renderer?.currentFrame,
      speech: window.__avatarLab?.speech?.speaking,
      event: window.__avatarLab?.diagnostics?.speech?.engine?.lastEventType,
    }));
    samples.push(sample);
    if (sample.lip > 0) lipValues.add(Number(sample.lip.toFixed(2)));
    if (sample.frame) mouthFrames.add(sample.frame);
    await page.waitForTimeout(45);
  }
  results.samples = samples;
  results.traceDuringSpeaking = await page.evaluate(() => window.__speechMock.trace);
  if (lipValues.size < 3) throw new Error(`expected at least 3 positive lip values: ${[...lipValues].join(',')}`);
  for (const frame of ['mouth-a', 'mouth-e', 'mouth-u']) {
    if (!mouthFrames.has(frame)) throw new Error(`speech animation did not show ${frame}: ${[...mouthFrames].join(',')}`);
  }
  results.lipValues = [...lipValues];
  results.mouthFrames = [...mouthFrames];
  results.speaking = await screenshot(page, '01-speaking.png');

  await page.waitForFunction(() => window.__avatarLab?.speech?.speaking === false, undefined, { timeout: 10_000 });
  await page.waitForFunction(() => window.__avatarLab?.diagnostics?.controller?.state === 'idle', undefined, { timeout: 10_000 });
  results.completed = await screenshot(page, '02-completed.png');

  const traceAfterCompletion = await page.evaluate(() => window.__speechMock.trace);
  const speakTrace = traceAfterCompletion.find((event) => event.type === 'speak');
  if (!speakTrace || speakTrace.voice !== 'zh-local' || speakTrace.rate !== 1.25 || speakTrace.pitch !== 1.1 || speakTrace.volume !== 0.7) {
    throw new Error(`utterance settings were not applied: ${JSON.stringify(traceAfterCompletion)}`);
  }
  if (!traceAfterCompletion.some((event) => event.type === 'end')) throw new Error('speech end event was not observed');
  results.completedTrace = traceAfterCompletion;

  await page.locator('#speech-text').fill('持续朗读[hold]');
  await page.locator('#speech-play').click();
  await page.waitForFunction(() => window.__avatarLab?.speech?.speaking === true, undefined, { timeout: 10_000 });
  await page.locator('#speech-stop').click();
  await page.waitForFunction(() => window.__avatarLab?.speech?.speaking === false, undefined, { timeout: 10_000 });
  await page.waitForFunction(() => window.__avatarLab?.diagnostics?.controller?.state === 'idle', undefined, { timeout: 10_000 });
  results.stopped = await screenshot(page, '03-stopped.png');
  const finalTrace = await page.evaluate(() => window.__speechMock.trace);
  if (!finalTrace.some((event) => event.type === 'cancel')) throw new Error('speech cancel was not observed');
  results.finalTrace = finalTrace;

  const locationProof = await page.evaluate(() => ({
    search: location.search,
    state: window.__avatarLab.state,
  }));
  if (decodeURIComponent(locationProof.search).includes('持续朗读')) throw new Error('spoken text leaked into URL state');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitReady(page);
  const restored = await page.evaluate(() => window.__avatarLab.state);
  if (restored.voice !== 'zh-local' || restored.rate !== 1.25 || restored.pitch !== 1.1 || restored.volume !== 0.7) {
    throw new Error(`speech settings failed to restore after reload: ${JSON.stringify(restored)}`);
  }
  results.restore = restored;

  await page.goto(`${baseUrl}/showcase?autoplay=0`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitReady(page);
  if (await page.locator('.speech-panel').isVisible()) throw new Error('speech panel is visible in Showcase');
  if (!await page.evaluate(() => typeof window.__avatarLab.speak === 'function' && typeof window.__avatarLab.stopSpeaking === 'function')) {
    throw new Error('public speech API is missing in Showcase');
  }
  results.showcase = await screenshot(page, '04-showcase.png');
  await context.close();

  const unsupportedContext = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await installUnsupportedSpeech(unsupportedContext);
  const unsupportedPage = await unsupportedContext.newPage();
  attachDiagnostics(unsupportedPage, 'unsupported');
  await unsupportedPage.goto(`${baseUrl}/studio?autoplay=0`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitReady(unsupportedPage);
  const unsupported = await unsupportedPage.evaluate(() => ({
    supported: window.__avatarLab.speech.supported,
    degraded: window.__avatarLab.degraded,
    playDisabled: document.querySelector('#speech-play').disabled,
    supportText: document.querySelector('#speech-support').textContent,
    renderer: window.__avatarLab.rendererKind,
  }));
  if (unsupported.supported) throw new Error('unsupported browser was incorrectly marked supported');
  if (unsupported.degraded) throw new Error('missing browser TTS degraded the avatar renderer');
  if (!unsupported.playDisabled) throw new Error('speech button is enabled in unsupported mode');
  if (!unsupported.supportText.includes('不支持')) throw new Error(`unsupported message is unclear: ${unsupported.supportText}`);
  results.unsupported = unsupported;
  results.unsupportedScreenshot = await screenshot(unsupportedPage, '05-unsupported.png');
  await unsupportedContext.close();

  if (fatalErrors.length) throw new Error(fatalErrors.join('\n'));
  results.status = 'pass';
  await writeFile(`${outputDir}/speech-results.json`, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  await writeFile(`${outputDir}/browser.log`, `${logs.join('\n')}\n`, 'utf8');
  console.log('Avatar Showcase v0.8 browser speech acceptance passed');
} catch (error) {
  results.error = error.stack || error.message;
  results.fatalErrors = fatalErrors;
  await writeFile(`${outputDir}/speech-results.json`, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  await writeFile(`${outputDir}/browser.log`, `${logs.join('\n')}\n`, 'utf8');
  throw error;
} finally {
  await browser.close();
}
