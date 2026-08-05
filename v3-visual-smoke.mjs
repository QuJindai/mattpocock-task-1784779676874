import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const baseUrl = process.env.VRM_URL || 'https://vrm-showcase-lab.vercel.app';
const out = 'v3-visual-smoke';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless:true, args:['--ignore-gpu-blocklist','--enable-webgl','--enable-unsafe-swiftshader','--use-angle=swiftshader-webgl'] });
const model = 'https://cdn.jsdelivr.net/gh/madjin/vrm-samples@master/vroid/stable/AvatarSample_A.vrm';
const buildId = 'visual-material-light-v3-20260805';
const scenarios = {
  idle: `mode=capture&url=${encodeURIComponent(model)}&action=idle&emotion=relaxed&distance=2.18&height=1.34&exposure=0.72&scale=1.08&fov=30&x=0.02`,
  wave: `mode=capture&url=${encodeURIComponent(model)}&action=wave&emotion=happy&distance=2.18&height=1.34&exposure=0.72&scale=1.08&fov=30&x=0.02`,
  closeup: `mode=capture&url=${encodeURIComponent(model)}&action=idle&emotion=relaxed&distance=1.72&height=1.43&exposure=0.70&scale=1.08&fov=29&x=0.02`,
};
const results = {};
const errors = [];
const sha = value => createHash('sha256').update(value).digest('hex');

for (const [name, query] of Object.entries(scenarios)) {
  const page = await browser.newPage({ viewport:{width:1600,height:900} });
  const pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(e.stack||e.message));
  try {
    await page.goto(`${baseUrl}/?${query}`, { waitUntil:'domcontentloaded', timeout:60_000 });
    await page.waitForFunction(() => document.querySelector('#model-status')?.textContent === '角色已就绪', undefined, {timeout:60_000});
    await page.waitForTimeout(2_000);
    const metrics = await page.evaluate(() => {
      const lab=window.__vrmLab;
      const gl=lab?.renderer?.getContext?.();
      const canvas=lab?.renderer?.domElement;
      if(!lab?.vrm||!gl||!canvas)return null;
      const w=canvas.width,h=canvas.height,p=new Uint8Array(w*h*4);
      gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,p);
      let minX=w,maxX=-1,minY=h,maxY=-1,count=0,luma=0;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const i=(y*w+x)*4,a=p[i+3];
        if(a>24){count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);luma+=.2126*p[i]+.7152*p[i+1]+.0722*p[i+2]}
      }
      return {buildId:lab.buildId??null,state:lab.state,count,averageLuma:count?luma/count:null,bounds:count?{minX,maxX,minY:h-1-maxY,maxY:h-1-minY,width:maxX-minX+1,height:maxY-minY+1,canvasWidth:w,canvasHeight:h}:null};
    });
    if(!metrics)throw new Error(`${name}: runtime metrics unavailable`);
    if(metrics.buildId!==buildId)throw new Error(`${name}: wrong build ${metrics.buildId}`);
    if(pageErrors.length)throw new Error(`${name}: pageerror\n${pageErrors.join('\n')}`);
    if(!metrics.bounds||metrics.bounds.height<metrics.bounds.canvasHeight*.42)throw new Error(`${name}: invalid avatar bounds ${JSON.stringify(metrics.bounds)}`);
    const image=await page.screenshot({path:`${out}/${name}.png`,fullPage:true});
    const canvasImage=await page.locator('canvas').screenshot({path:`${out}/${name}-canvas.png`});
    results[name]={...metrics,fullHash:sha(image),canvasHash:sha(canvasImage),url:page.url()};
  }catch(error){
    errors.push(error.stack||error.message);
    await page.screenshot({path:`${out}/${name}-failed.png`,fullPage:true}).catch(()=>{});
  }finally{await page.close()}
}
await browser.close();
if(results.idle&&results.wave&&results.idle.canvasHash===results.wave.canvasHash)errors.push('idle and wave canvases are identical');
if(results.idle&&results.closeup&&results.idle.canvasHash===results.closeup.canvasHash)errors.push('idle and closeup canvases are identical');
await writeFile(`${out}/results.json`,`${JSON.stringify({buildId,results,errors},null,2)}\n`,'utf8');
console.log(JSON.stringify({buildId,passed:Object.keys(results),errors},null,2));
if(errors.length)process.exitCode=1;
