import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const baseUrl = process.env.VRM_URL || 'https://vrm-showcase-lab.vercel.app';
const outputDir = 'artifacts';
await mkdir(outputDir, { recursive: true });

const models = {
  avatarA: 'https://cdn.jsdelivr.net/gh/madjin/vrm-samples@master/vroid/stable/AvatarSample_A.vrm',
  avatarB: 'https://cdn.jsdelivr.net/gh/madjin/vrm-samples@master/vroid/stable/AvatarSample_B.vrm',
  shino: 'https://file-in-abyss.soga-web.studio/download/vrm/06-sendagaya-shino.vrm',
  vita: 'https://file-in-abyss.soga-web.studio/download/vrm/03-vita.vrm',
  victoria: 'https://file-in-abyss.soga-web.studio/download/vrm/04-victoria-rubin.vrm',
  invalid: 'https://example.invalid/not-found.vrm',
};

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist','--enable-webgl','--enable-unsafe-swiftshader','--use-angle=swiftshader-webgl'],
});
const logs = [];
const results = new Map();
const failures = [];
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function capture({ name, query = '', expect = 'ready', verify }) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  const requestFailures = [];
  page.on('console', m => logs.push(`[${name}][console:${m.type()}] ${m.text()}`));
  page.on('pageerror', e => { pageErrors.push(e.stack || e.message); logs.push(`[${name}][pageerror] ${e.stack || e.message}`); });
  page.on('requestfailed', r => {
    const item = { message: `${r.url()} :: ${r.failure()?.errorText}`, resourceType: r.resourceType(), url: r.url() };
    requestFailures.push(item); logs.push(`[${name}][requestfailed] ${item.message}`);
  });
  const url = `${baseUrl}/${query ? `?${query}` : ''}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    const expectedText = expect === 'ready' ? '角色已就绪' : '加载失败';
    try {
      await page.waitForFunction(text => document.querySelector('#model-status')?.textContent === text, expectedText, { timeout: 120_000 });
    } catch (error) {
      await page.screenshot({ path: `${outputDir}/${name}-failed.png`, fullPage: true });
      await writeFile(`${outputDir}/${name}-failed.html`, await page.content(), 'utf8');
      throw new Error(`${name}: expected state '${expectedText}' not reached`, { cause: error });
    }
    await page.waitForTimeout(2_500);
    let runtime = null;
    if (expect === 'ready') {
      runtime = await page.evaluate(() => {
        const lab = window.__vrmLab;
        const vrm = lab?.vrm;
        if (!vrm) return null;
        const renderer = lab.renderer;
        const gl = renderer?.getContext?.();
        const canvas = renderer?.domElement;
        let pixelBounds = null;
        if (gl && canvas) {
          const width = canvas.width;
          const height = canvas.height;
          const pixels = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let minX = width, maxX = -1, minYGl = height, maxYGl = -1, count = 0;
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              const alpha = pixels[(y * width + x) * 4 + 3];
              if (alpha > 24) {
                count += 1;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minYGl) minYGl = y;
                if (y > maxYGl) maxYGl = y;
              }
            }
          }
          if (count > 0) {
            pixelBounds = {
              minX,
              maxX,
              minY: height - 1 - maxYGl,
              maxY: height - 1 - minYGl,
              width: maxX - minX + 1,
              height: maxYGl - minYGl + 1,
              count,
              canvasWidth: width,
              canvasHeight: height,
            };
          }
        }
        const projectPoint = point => {
          if (!point || !lab.camera) return null;
          lab.camera.updateMatrixWorld(true);
          const view = lab.camera.matrixWorldInverse.elements;
          const proj = lab.camera.projectionMatrix.elements;
          const [x, y, z] = point;
          const vx = view[0]*x + view[4]*y + view[8]*z + view[12];
          const vy = view[1]*x + view[5]*y + view[9]*z + view[13];
          const vz = view[2]*x + view[6]*y + view[10]*z + view[14];
          const vw = view[3]*x + view[7]*y + view[11]*z + view[15];
          const cx = proj[0]*vx + proj[4]*vy + proj[8]*vz + proj[12]*vw;
          const cy = proj[1]*vx + proj[5]*vy + proj[9]*vz + proj[13]*vw;
          const cz = proj[2]*vx + proj[6]*vy + proj[10]*vz + proj[14]*vw;
          const cw = proj[3]*vx + proj[7]*vy + proj[11]*vz + proj[15]*vw;
          return [cx/cw, cy/cw, cz/cw];
        };
        const fitDebug = lab.fitDebug ?? null;
        return {
          metaVersion: String(vrm.meta?.metaVersion ?? vrm.meta?.specVersion ?? ''),
          rotationY: vrm.scene?.rotation?.y,
          state: lab.state,
          fitDebug,
          projections: fitDebug ? {
            head: projectPoint(fitDebug.head),
            hips: projectPoint(fitDebug.hips),
            leftFoot: projectPoint(fitDebug.leftFoot),
            rightFoot: projectPoint(fitDebug.rightFoot),
          } : null,
          pixelBounds,
          camera: {
            x: lab.camera?.position?.x,
            y: lab.camera?.position?.y,
            z: lab.camera?.position?.z,
            fov: lab.camera?.fov,
            quaternion: lab.camera?.quaternion?.toArray?.(),
          },
        };
      });
      if (!runtime || !Number.isFinite(runtime.rotationY)) throw new Error(`${name}: runtime VRM handle unavailable`);
      if (runtime.metaVersion === '0' && Math.abs(Math.abs(runtime.rotationY) - Math.PI) > .05) {
        throw new Error(`${name}: VRM0 front correction missing; rotationY=${runtime.rotationY}`);
      }
      const fit = runtime.fitDebug;
      const footY = Math.min(fit?.leftFoot?.[1] ?? Infinity, fit?.rightFoot?.[1] ?? Infinity);
      const headY = fit?.head?.[1];
      if (!fit || !Number.isFinite(headY) || !Number.isFinite(footY)) {
        throw new Error(`${name}: humanoid fit diagnostics unavailable: ${JSON.stringify(fit)}`);
      }
      if (Math.abs(footY - 0.015) > 0.08 || headY < 1.15 || headY > 1.85) {
        throw new Error(`${name}: humanoid stage fit invalid: ${JSON.stringify(fit)}`);
      }
      const bounds = runtime.pixelBounds;
      if (!bounds || bounds.count < 10_000) {
        throw new Error(`${name}: rendered avatar pixels unavailable: ${JSON.stringify(bounds)}`);
      }
      if (bounds.height < bounds.canvasHeight * 0.42 || bounds.minY > bounds.canvasHeight * 0.52) {
        throw new Error(`${name}: avatar framing invalid: ${JSON.stringify(bounds)}`);
      }
    }
    if (verify) await verify(page, runtime);
    if (pageErrors.length) throw new Error(`${name}: page errors:\n${pageErrors.join('\n')}`);
    const fatal = requestFailures.filter(({resourceType,url:failedUrl}) => {
      if (expect === 'failure' && failedUrl.includes('example.invalid')) return false;
      return failedUrl.endsWith('.vrm') || ['document','script','fetch','xhr'].includes(resourceType);
    });
    if (fatal.length) throw new Error(`${name}: fatal requests:\n${fatal.map(x=>x.message).join('\n')}`);
    const full = await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true });
    const canvas = await page.locator('canvas').screenshot({ path: `${outputDir}/${name}-canvas.png` });
    await writeFile(`${outputDir}/${name}.html`, await page.content(), 'utf8');
    results.set(name, { fullHash: hash(full), canvasHash: hash(canvas), runtime, url: page.url() });
  } catch (error) {
    failures.push(error.stack || error.message);
    logs.push(`[${name}][failure] ${error.stack || error.message}`);
  } finally { await page.close(); }
}

const common = 'mode=capture&url=' + encodeURIComponent(models.avatarA);
await capture({ name:'01-showcase-idle', query:`${common}&action=idle&emotion=relaxed&distance=2.18&height=1.34&exposure=0.82&scale=1.08&fov=30&x=0.02` });
await capture({ name:'02-showcase-wave', query:`${common}&action=wave&emotion=happy&distance=2.18&height=1.34&exposure=0.82&scale=1.08&fov=30&x=0.02` });
await capture({ name:'03-showcase-closeup', query:`${common}&action=idle&emotion=relaxed&distance=1.72&height=1.43&exposure=0.80&scale=1.08&fov=29&x=0.02` });
const bakeoffPreset='mode=capture&action=idle&emotion=relaxed&distance=2.05&height=1.36&exposure=0.76&scale=1.08&fov=29&x=0.02';
await capture({ name:'06-model-shino', query:`${bakeoffPreset}&url=${encodeURIComponent(models.shino)}` });
await capture({ name:'07-model-vita', query:`${bakeoffPreset}&url=${encodeURIComponent(models.vita)}` });
await capture({ name:'08-model-victoria', query:`${bakeoffPreset}&url=${encodeURIComponent(models.victoria)}` });
await capture({
  name:'04-studio-restore',
  query:`mode=studio&url=${encodeURIComponent(models.avatarB)}&action=listen&emotion=happy&distance=2.25&height=1.40&exposure=0.76&scale=1.05&fov=31&x=-0.08`,
  verify: async page => {
    await page.reload({ waitUntil:'domcontentloaded', timeout:120_000 });
    await page.waitForFunction(() => document.querySelector('#model-status')?.textContent === '角色已就绪', undefined, { timeout:120_000 });
    const restored = await page.evaluate(() => ({
      mode:new URL(location.href).searchParams.get('mode'),
      action:document.querySelector('[data-action].on')?.getAttribute('data-action'),
      emotion:document.querySelector('[data-emotion].on')?.getAttribute('data-emotion'),
      distance:document.querySelector('#distance')?.value,
      height:document.querySelector('#height')?.value,
      exposure:document.querySelector('#exposure')?.value,
      scale:document.querySelector('#scale')?.value,
      fov:document.querySelector('#fov')?.value,
      x:document.querySelector('#x')?.value,
    }));
    const expected = { mode:'studio',action:'listen',emotion:'happy',distance:'2.25',height:'1.4',exposure:'0.76',scale:'1.05',fov:'31',x:'-0.08' };
    if (JSON.stringify(restored) !== JSON.stringify(expected)) throw new Error(`restore mismatch: ${JSON.stringify({restored,expected})}`);
  },
});
await capture({ name:'05-invalid-model', query:`mode=studio&url=${encodeURIComponent(models.invalid)}`, expect:'failure' });

const idle=results.get('01-showcase-idle'),wave=results.get('02-showcase-wave'),close=results.get('03-showcase-closeup');
if(idle&&wave&&idle.canvasHash===wave.canvasHash) failures.push('showcase idle and wave canvases are identical');
if(idle&&close&&idle.canvasHash===close.canvasHash) failures.push('showcase idle and closeup canvases are identical');
await writeFile(`${outputDir}/browser.log`,`${logs.join('\n')}\n`,'utf8');
await writeFile(`${outputDir}/results.json`,`${JSON.stringify({results:Object.fromEntries(results),failures},null,2)}\n`,'utf8');
await browser.close();
if(failures.length) throw new Error(`Visual iteration acceptance failed:\n${failures.join('\n\n')}`);
console.log(`Visual iteration acceptance passed: ${results.size} scenarios`);
