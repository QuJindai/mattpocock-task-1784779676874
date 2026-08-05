import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const BASE = process.env.V47_URL || 'http://127.0.0.1:4173';
const OUT = path.resolve('v47-visual-bakeoff');
await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-webgl'],
});

function luma(r,g,b){return .2126*r+.7152*g+.0722*b}
function alphaBounds(png){
  let minX=png.width,minY=png.height,maxX=-1,maxY=-1,count=0;
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
    const i=(y*png.width+x)*4;if(png.data[i+3]>28){count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}
  }
  return count?{minX,minY,maxX,maxY,width:maxX-minX+1,height:maxY-minY+1,count}:null;
}
function region(bounds,fx1,fy1,fx2,fy2){return {x1:Math.round(bounds.minX+bounds.width*fx1),y1:Math.round(bounds.minY+bounds.height*fy1),x2:Math.round(bounds.minX+bounds.width*fx2),y2:Math.round(bounds.minY+bounds.height*fy2)}}
function sampleCharacter(png,bounds){
  const face=region(bounds,.36,.055,.64,.29),hair=region(bounds,.27,.0,.73,.31),cardigan=region(bounds,.13,.30,.87,.76);
  const stats={face:{n:0,sum:0,sum2:0},hair:{n:0,brown:0,purple:0,r:0,g:0,b:0},cardigan:{n:0,cream:0,pink:0,r:0,g:0,b:0}};
  for(let y=bounds.minY;y<=bounds.maxY;y++)for(let x=bounds.minX;x<=bounds.maxX;x++){
    const i=(y*png.width+x)*4,a=png.data[i+3];if(a<28)continue;const r=png.data[i],g=png.data[i+1],b=png.data[i+2],L=luma(r,g,b)/255;
    if(x>=face.x1&&x<=face.x2&&y>=face.y1&&y<=face.y2){stats.face.n++;stats.face.sum+=L;stats.face.sum2+=L*L}
    if(x>=hair.x1&&x<=hair.x2&&y>=hair.y1&&y<=hair.y2&&L>.035){stats.hair.n++;stats.hair.r+=r;stats.hair.g+=g;stats.hair.b+=b;if(r>b*1.05&&r>g*1.02)stats.hair.brown++;if(r>g*1.10&&b>g*1.08&&Math.abs(r-b)<95)stats.hair.purple++}
    if(x>=cardigan.x1&&x<=cardigan.x2&&y>=cardigan.y1&&y<=cardigan.y2){stats.cardigan.n++;stats.cardigan.r+=r;stats.cardigan.g+=g;stats.cardigan.b+=b;if(L>.42&&r>=g&&g>b&&r-g<42&&g-b<45)stats.cardigan.cream++;if(L>.38&&r>g*1.07&&r>b*1.03&&b>g*.88)stats.cardigan.pink++}
  }
  const f=stats.face,hn=Math.max(1,stats.hair.n),cn=Math.max(1,stats.cardigan.n),mean=f.sum/Math.max(1,f.n);
  return {
    faceContrast:Math.sqrt(Math.max(0,f.sum2/Math.max(1,f.n)-mean*mean)),faceMean:mean,
    hairBrownRatio:stats.hair.brown/hn,hairPurpleRatio:stats.hair.purple/hn,hairMean:[stats.hair.r/hn,stats.hair.g/hn,stats.hair.b/hn],
    cardiganCreamRatio:stats.cardigan.cream/cn,cardiganPinkRatio:stats.cardigan.pink/cn,cardiganMean:[stats.cardigan.r/cn,stats.cardigan.g/cn,stats.cardigan.b/cn],
  };
}
function edgeEnergy(png,boxes){
  let total=0,n=0;
  for(const box of boxes)for(let y=box.y1+1;y<box.y2-1;y+=2)for(let x=box.x1+1;x<box.x2-1;x+=2){
    const i=(y*png.width+x)*4,ix=(y*png.width+x+1)*4,iy=((y+1)*png.width+x)*4;
    const a=luma(png.data[i],png.data[i+1],png.data[i+2]);
    total+=Math.abs(a-luma(png.data[ix],png.data[ix+1],png.data[ix+2]))+Math.abs(a-luma(png.data[iy],png.data[iy+1],png.data[iy+2]));n+=2;
  }
  return total/Math.max(1,n);
}
async function readPng(file){return PNG.sync.read(await fs.readFile(file))}
async function sha(file){return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')}

const results={base:BASE,generatedAt:new Date().toISOString(),candidates:{},failures:[]};
for(const key of ['a','b','c']){
  const logs=[],fatal=[];
  const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
  page.on('console',m=>logs.push(`[console:${m.type()}] ${m.text()}`));
  page.on('pageerror',e=>fatal.push(`pageerror: ${e.message}`));
  page.on('requestfailed',r=>fatal.push(`requestfailed: ${r.url()} :: ${r.failure()?.errorText}`));
  const url=`${BASE}/${key}.html?mode=capture&action=idle&framing=standard&emotion=relaxed&exposure=.68`;
  const started=Date.now();
  try{
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>document.querySelector('#model-status')?.textContent==='角色已就绪',{timeout:30000});
    await page.waitForTimeout(2600);
    const readyMs=Date.now()-started;
    const lab=await page.evaluate(()=>({buildId:window.__vrmLab?.buildId,state:window.__vrmLab?.state,v47:window.__vrmLab?.v47,error:window.__vrmLab?.error}));
    if(lab.buildId!==`visual-avatar-a-v4-7-${key}-20260805`)throw new Error(`build mismatch ${lab.buildId}`);
    if(!lab.v47?.ready)throw new Error('v47 report not ready');
    const idle=path.join(OUT,`${key}-idle.png`),idleCanvas=path.join(OUT,`${key}-idle-canvas.png`);
    await page.screenshot({path:idle});await page.locator('#canvas').screenshot({path:idleCanvas});
    const idlePng=await readPng(idleCanvas),fullPng=await readPng(idle),bounds=alphaBounds(idlePng);if(!bounds)throw new Error('no character pixels');
    const color=sampleCharacter(idlePng,bounds);
    const backgroundEdge=edgeEnergy(fullPng,[{x1:30,y1:90,x2:560,y2:700},{x1:1010,y1:80,x2:1570,y2:700}]);
    await page.evaluate(()=>{const b=document.querySelector('[data-action="wave"]');b?.click()});await page.waitForTimeout(1100);
    const waveCanvas=path.join(OUT,`${key}-wave-canvas.png`);await page.locator('#canvas').screenshot({path:waveCanvas});
    await page.evaluate(()=>{const b=document.querySelector('[data-framing="closeup"]');b?.click()});await page.waitForTimeout(2600);
    const close=path.join(OUT,`${key}-closeup.png`),closeCanvas=path.join(OUT,`${key}-closeup-canvas.png`);await page.screenshot({path:close});await page.locator('#canvas').screenshot({path:closeCanvas});
    const closeBounds=alphaBounds(await readPng(closeCanvas));
    const hashes={idle:await sha(idleCanvas),wave:await sha(waveCanvas),closeup:await sha(closeCanvas)};
    if(hashes.idle===hashes.wave)throw new Error('wave canvas equals idle');if(hashes.idle===hashes.closeup)throw new Error('closeup canvas equals idle');
    if(fatal.length)throw new Error(fatal.join('\n'));
    results.candidates[key]={url,readyMs,lab,bounds,closeBounds,color,backgroundEdge,hashes};
  }catch(error){
    results.failures.push(`${key}: ${error.stack||error}`);results.candidates[key]={error:String(error),fatal};
    await page.screenshot({path:path.join(OUT,`${key}-failed.png`),fullPage:true}).catch(()=>{});
  }finally{
    await fs.writeFile(path.join(OUT,`${key}.log`),logs.concat(fatal).join('\n'));await page.close();
  }
}
await browser.close();
await fs.writeFile(path.join(OUT,'metrics.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
if(results.failures.length)throw new Error(results.failures.join('\n'));
