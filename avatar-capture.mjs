import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.AVATAR_URL || 'https://avatar-showcase-lab.vercel.app';
const accessUrl = process.env.AVATAR_ACCESS_URL || '';
const outputDir = 'avatar-artifacts';
const expectedRuntime = 'https://ezvfqrhzucjvkwnnbjux.supabase.co/functions/v1/avatar-motion-runtime';
const expectedBackend = 'fffiloni/expression-editor';
const expectedEndpoint = '/edit_expression';
const sessionKey = 'avatar-showcase.generated-character';

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({headless:true,args:['--ignore-gpu-blocklist','--enable-webgl','--enable-unsafe-swiftshader','--use-angle=swiftshader-webgl']});
const page = await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
const logs=[];const fatalErrors=[];
page.on('console',m=>logs.push(`[console:${m.type()}] ${m.text()}`));
page.on('pageerror',e=>{const t=e.stack||e.message;fatalErrors.push(`[pageerror] ${t}`);logs.push(`[pageerror] ${t}`)});
page.on('requestfailed',r=>{const t=`${r.url()} :: ${r.failure()?.errorText}`;logs.push(`[requestfailed] ${t}`);if(['document','script'].includes(r.resourceType()))fatalErrors.push(`[requestfailed] ${t}`)});

async function fail(message){await page.screenshot({path:`${outputDir}/failed.png`,fullPage:true}).catch(()=>{});await writeFile(`${outputDir}/failed.html`,await page.content(),'utf8').catch(()=>{});throw new Error(message)}
async function setRange(id,value){await page.locator(`#${id}`).evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}))},value)}
const sha256=b=>createHash('sha256').update(b).digest('hex');

try{
  if(accessUrl){
    await page.goto(accessUrl,{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForTimeout(3000);
    logs.push(`[access-bootstrap] ${page.url()}`);
  }
  await page.goto(`${baseUrl}/studio`,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForSelector('canvas.stage',{timeout:60000});
  await page.waitForSelector('#connect',{timeout:60000});
  await page.waitForTimeout(5000);
  await page.screenshot({path:`${outputDir}/01-studio.png`,fullPage:true});

  const canvasBox=await page.locator('canvas.stage').boundingBox();
  if(!canvasBox||canvasBox.width<800||canvasBox.height<500)await fail(`invalid canvas: ${JSON.stringify(canvasBox)}`);
  const backendValue=await page.inputValue('#backend');
  if(backendValue!==expectedRuntime)await fail(`unexpected runtime: ${backendValue}`);
  const initialField=await page.inputValue('#character');
  if(initialField!=='session:generated')await fail(`embedded character not represented by session marker: ${initialField.slice(0,80)}`);
  const initialSession=await page.evaluate(key=>sessionStorage.getItem(key),sessionKey);
  if(!initialSession?.startsWith('data:image/')||initialSession.length<20000)await fail(`initial session character invalid: ${initialSession?.length||0}`);

  await page.click('#connect');
  await page.waitForFunction(()=>['GPU已连接','GPU连接失败'].includes(document.querySelector('#gpu-status')?.textContent||''),undefined,{timeout:120000});
  const connectionState=await page.locator('#gpu-status').textContent();
  const connectionDetail=await page.locator('#gpu-detail').textContent();
  if(connectionState!=='GPU已连接')await fail(`runtime health failed: ${connectionDetail}`);

  const apiInfo=await page.evaluate(()=>({endpoint:window.__avatarLab?.imageEndpoint,runtimeUrl:window.__avatarLab?.runtimeUrl,backend:window.__avatarLab?.apiInfo?.backend,service:window.__avatarLab?.apiInfo?.service,ok:window.__avatarLab?.apiInfo?.ok}));
  if(apiInfo.endpoint!==expectedEndpoint||apiInfo.runtimeUrl!==expectedRuntime||apiInfo.backend!==expectedBackend||apiInfo.ok!==true)await fail(`unexpected runtime API info: ${JSON.stringify(apiInfo)}`);
  await writeFile(`${outputDir}/api-info.json`,`${JSON.stringify(apiInfo,null,2)}\n`);
  await page.screenshot({path:`${outputDir}/02-runtime-connected.png`,fullPage:true});

  const expression={pitch:-3,yaw:8,roll:2,blink:-1,eyebrow:4,wink:1,pupilX:2,pupilY:-1,aaa:18,eee:0,woo:0,smile:.45,cropFactor:1.7};
  for(const [id,value] of Object.entries(expression))await setRange(id,value);
  const beforeSession=await page.evaluate(key=>sessionStorage.getItem(key),sessionKey);
  const startedAt=Date.now();
  await page.click('#generate-frame');
  await page.waitForFunction(()=>['GPU结果已载入','GPU生成失败'].includes(document.querySelector('#gpu-status')?.textContent||''),undefined,{timeout:240000});
  const generationElapsedMs=Date.now()-startedAt;
  const generationState=await page.locator('#gpu-status').textContent();
  const generationDetail=await page.locator('#gpu-detail').textContent();
  if(generationState!=='GPU结果已载入')await fail(`runtime generation failed: ${generationDetail}`);

  const proof=await page.evaluate(key=>({field:document.querySelector('#character')?.value,session:sessionStorage.getItem(key),last:window.__avatarLab?.lastGeneration}),sessionKey);
  if(proof.field!=='session:generated')await fail(`generated field marker missing: ${proof.field}`);
  if(!proof.session?.startsWith('data:image/webp;base64,')||proof.session===beforeSession||proof.session.length<100000)await fail(`generated session asset invalid: ${proof.session?.length||0}`);
  if(proof.last?.backend!==expectedBackend||proof.last?.endpoint!==expectedEndpoint||proof.last?.imageBytes<50000)await fail(`generation proof invalid: ${JSON.stringify(proof.last)}`);

  await page.waitForTimeout(5000);
  await page.screenshot({path:`${outputDir}/03-gpu-result.png`,fullPage:true});
  const resultCanvas=await page.locator('canvas.stage').screenshot({path:`${outputDir}/03-gpu-result-canvas.png`});
  if(resultCanvas.length<50000)await fail(`result canvas too small: ${resultCanvas.length}`);

  await page.goto(`${baseUrl}/capture?character=session%3Agenerated&action=happy&scale=1.15`,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForSelector('canvas.stage',{timeout:60000});
  await page.waitForTimeout(5000);
  const captureImage=await page.screenshot({path:`${outputDir}/04-capture.png`,fullPage:true});
  if(captureImage.length<50000)await fail(`capture too small: ${captureImage.length}`);

  if(fatalErrors.length)await fail(fatalErrors.join('\n'));
  const result={status:'pass',baseUrl,apiInfo,expression,generationElapsedMs,generationDetail,generatedDataUrlLength:proof.session.length,imageBytes:proof.last.imageBytes,runtimeElapsedMs:proof.last.elapsedMs,resultCanvasBytes:resultCanvas.length,resultCanvasSha256:sha256(resultCanvas),captureBytes:captureImage.length,captureSha256:sha256(captureImage),fatalErrors};
  await writeFile(`${outputDir}/browser.log`,`${logs.join('\n')}\n`);
  await writeFile(`${outputDir}/results.json`,`${JSON.stringify(result,null,2)}\n`);
  console.log('Avatar showcase v0.5 runtime acceptance passed');
}catch(error){logs.push(`[fatal] ${error.stack||error.message}`);await writeFile(`${outputDir}/browser.log`,`${logs.join('\n')}\n`);await writeFile(`${outputDir}/results.json`,`${JSON.stringify({status:'fail',baseUrl,error:error.stack||error.message,fatalErrors},null,2)}\n`);throw error}finally{await browser.close()}
