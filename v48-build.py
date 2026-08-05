from __future__ import annotations

import base64
import gzip
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(os.environ.get('V48_REPO_ROOT', '.')).resolve()
OUT = ROOT / 'v48-site'
BUILD_ID = 'visual-avatar-a-v4-8-20260805'


def read_source() -> str:
    explicit = os.environ.get('V48_SOURCE_HTML')
    if explicit:
        return Path(explicit).read_text(encoding='utf-8')
    blocks = sorted((ROOT / 'payloads' / 'v47').glob('payload-*.txt'))
    if not blocks:
        raise FileNotFoundError('V4.7 payload blocks not found')
    encoded = ''.join(p.read_text(encoding='utf-8').strip() for p in blocks)
    return gzip.decompress(base64.b64decode(encoded)).decode('utf-8')


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise ValueError(f'{label}: expected 1 match, found {count}')
    return source.replace(old, new, 1)


def extract(source: str, start: str, end: str) -> str:
    a = source.index(start)
    b = source.index(end, a)
    return source[a:b]


V48_RUNTIME = r'''const v48Report={ready:true,version:'liveliness-v1',motion:{frameCount:0,breath:0,shoulder:0,gazeX:0,gazeY:0,headYaw:0,hipOffset:0},blink:{value:0,count:0,next:1.85,lastInterval:null,doubleCount:0,history:[]},spring:{available:false,drivenByHead:true}};
const v48Motion={gazeX:0,gazeY:0,blinkStart:-1,blinkDuration:.20,blinkIndex:0,nextBlink:1.85,doubleAt:-1,isDouble:false,baseHipsY:0};
function v48Rand(i){const x=Math.sin((i+1)*12.9898+78.233)*43758.5453;return x-Math.floor(x)}
function v48Reset(t){const hips=vrm?.humanoid?.getNormalizedBoneNode('hips');v48Motion.baseHipsY=hips?.position.y??0;v48Motion.gazeX=0;v48Motion.gazeY=0;v48Motion.blinkStart=-1;v48Motion.blinkIndex=0;v48Motion.nextBlink=t+1.85;v48Motion.doubleAt=-1;v48Motion.isDouble=false;v48Report.motion.frameCount=0;v48Report.motion.hipOffset=0;v48Report.blink.value=0;v48Report.blink.count=0;v48Report.blink.next=v48Motion.nextBlink;v48Report.blink.lastInterval=null;v48Report.blink.doubleCount=0;v48Report.blink.history.length=0;blink=0}
function v48ScheduleBlink(t){const interval=2.2+v48Rand(v48Motion.blinkIndex)*3.2;v48Motion.nextBlink=t+interval;v48Report.blink.next=v48Motion.nextBlink;v48Report.blink.lastInterval=interval;v48Report.blink.history.push(interval);if(v48Report.blink.history.length>8)v48Report.blink.history.shift()}
function v48BlinkTarget(t){
  if(v48Motion.doubleAt>0&&t>=v48Motion.doubleAt&&v48Motion.blinkStart<0){v48Motion.blinkStart=t;v48Motion.doubleAt=-1;v48Motion.isDouble=true;v48Motion.nextBlink=Infinity}
  else if(v48Motion.blinkStart<0&&t>=v48Motion.nextBlink){v48Motion.blinkStart=t;v48Motion.isDouble=false}
  if(v48Motion.blinkStart<0)return 0;
  const phase=(t-v48Motion.blinkStart)/v48Motion.blinkDuration;
  if(phase<=1)return Math.sin(Math.PI*Math.max(0,phase));
  v48Motion.blinkStart=-1;v48Motion.blinkIndex++;v48Report.blink.count=v48Motion.blinkIndex;
  if(v48Motion.isDouble){v48Motion.isDouble=false;v48ScheduleBlink(t)}
  else if(v48Motion.blinkIndex%4===0){v48Motion.doubleAt=t+.15;v48Motion.nextBlink=Infinity;v48Report.blink.next=v48Motion.doubleAt;v48Report.blink.doubleCount++}
  else v48ScheduleBlink(t);
  return 0
}
'''


V48_ANIMATE = r'''function animate(t,dt){
  if(!vrm)return;
  for(const[n,v]of Object.entries(poses[state.action]||poses.idle))damp(n,v,dt);
  const h=vrm.humanoid,spine=h.getNormalizedBoneNode('spine'),chest=h.getNormalizedBoneNode('chest'),neck=h.getNormalizedBoneNode('neck'),head=h.getNormalizedBoneNode('head'),hips=h.getNormalizedBoneNode('hips'),leftShoulder=h.getNormalizedBoneNode('leftShoulder'),rightShoulder=h.getNormalizedBoneNode('rightShoulder');
  const breath=Math.sin(t*1.04)*.76+Math.sin(t*.52+.9)*.24,slow=Math.sin(t*.37+.55),shoulder=breath*.006+Math.sin(t*.69+1.2)*.0025;
  if(spine){spine.rotation.z=THREE.MathUtils.damp(spine.rotation.z,slow*.008+breath*.0025,5,dt);spine.rotation.x=THREE.MathUtils.damp(spine.rotation.x,breath*.0035,5,dt)}
  if(chest){chest.rotation.x=THREE.MathUtils.damp(chest.rotation.x,.006+breath*.014,5.5,dt);chest.rotation.z=THREE.MathUtils.damp(chest.rotation.z,Math.sin(t*.31)*.004,4.2,dt)}
  const hipTarget=v48Motion.baseHipsY+breath*.0045;if(hips)hips.position.y=THREE.MathUtils.damp(hips.position.y,hipTarget,5.5,dt);
  if(leftShoulder){leftShoulder.rotation.z=THREE.MathUtils.damp(leftShoulder.rotation.z,.004+shoulder,5,dt);leftShoulder.rotation.x=THREE.MathUtils.damp(leftShoulder.rotation.x,breath*.0025,5,dt)}
  if(rightShoulder){rightShoulder.rotation.z=THREE.MathUtils.damp(rightShoulder.rotation.z,-.004-shoulder*.82,5,dt);rightShoulder.rotation.x=THREE.MathUtils.damp(rightShoulder.rotation.x,breath*.0021,5,dt)}
  const pointerActive=t-pointer.last<2.6,autoX=Math.sin(t*.23+.4)*.028+Math.sin(t*.61)*.009,autoY=Math.sin(t*.19+1.3)*.012;
  const targetX=pointerActive?pointer.x*.13:autoX,targetY=pointerActive?-pointer.y*.055:autoY;
  v48Motion.gazeX=THREE.MathUtils.damp(v48Motion.gazeX,targetX,pointerActive?4.8:2.4,dt);v48Motion.gazeY=THREE.MathUtils.damp(v48Motion.gazeY,targetY,pointerActive?4.8:2.2,dt);
  if(neck){neck.rotation.z=THREE.MathUtils.damp(neck.rotation.z,state.action==='listen'?.08:slow*.008,5.2,dt);neck.rotation.x=THREE.MathUtils.damp(neck.rotation.x,Math.sin(t*.29)*.004,4.5,dt)}
  if(head){head.rotation.y=THREE.MathUtils.damp(head.rotation.y,v48Motion.gazeX+Math.sin(t*.41)*.006,5.4,dt);head.rotation.x=THREE.MathUtils.damp(head.rotation.x,v48Motion.gazeY+Math.sin(t*.33+.8)*.004,5.2,dt);head.rotation.z=THREE.MathUtils.damp(head.rotation.z,Math.sin(t*.27+.2)*.005,4.5,dt)}
  if(state.action==='wave'){const hand=h.getNormalizedBoneNode('leftHand');if(hand)hand.rotation.z=Math.sin(t*6.3)*.31}
  const blinkTarget=v48BlinkTarget(t);blink=THREE.MathUtils.damp(blink,blinkTarget,30,dt);
  if(vrm.expressionManager){try{vrm.expressionManager.setValue('aa',state.action==='talk'?.15+.21*(.5+.5*Math.sin(t*7.4)):0)}catch{}try{vrm.expressionManager.setValue('blink',blink)}catch{}}
  v48Report.motion.frameCount++;v48Report.motion.breath=breath;v48Report.motion.shoulder=shoulder;v48Report.motion.gazeX=v48Motion.gazeX;v48Report.motion.gazeY=v48Motion.gazeY;v48Report.motion.headYaw=head?.rotation.y??0;v48Report.motion.hipOffset=(hips?.position.y??v48Motion.baseHipsY)-v48Motion.baseHipsY;v48Report.blink.value=blink;v48Report.spring.available=Boolean(vrm.springBoneManager)
}
'''


def build(source: str) -> str:
    required = [
        "visual-avatar-a-v4-7-20260805",
        "const poses=",
        "function fit()",
        "async function frame()",
        "function animate(t,dt)",
        "addEventListener('pointermove'",
    ]
    for marker in required:
        if marker not in source:
            raise ValueError(f'missing source marker: {marker}')

    out = source
    out = out.replace('VRM Showcase Lab V4.7', 'VRM Showcase Lab V4.8')
    out = out.replace('V4.7 · Avatar A / Night Apartment', 'V4.8 · Avatar A / Night Apartment')
    out = replace_once(out, 'visual-avatar-a-v4-7-20260805', BUILD_ID, 'build id')

    old_vars = "const v47Report={candidate:'d',ready:false,materials:{},textures:{},integration:true};let vrm=null,modelHeight=1.6,fitDebug=null,pointer={x:0,y:0},blink=0,frameToken=0,timers=[];"
    new_vars = "const v47Report={candidate:'d',ready:false,materials:{},textures:{},integration:true};" + V48_RUNTIME + "let vrm=null,modelHeight=1.6,fitDebug=null,pointer={x:0,y:0,last:-999},blink=0,frameToken=0,timers=[];"
    out = replace_once(out, old_vars, new_vars, 'runtime state')

    old_publish = "function publish(error){window.__vrmLab=error?{buildId:BUILD_ID,state,vrm:null,error:String(error)}:{buildId:BUILD_ID,state,vrm,scene,camera,renderer,fitDebug,v47:v47Report,metaVersion:String(vrm?.meta?.metaVersion??vrm?.meta?.specVersion??'unknown')}}"
    new_publish = "function publish(error){window.__vrmLab=error?{buildId:BUILD_ID,state,vrm:null,error:String(error)}:{buildId:BUILD_ID,state,vrm,scene,camera,renderer,fitDebug,v47:v47Report,v48:v48Report,metaVersion:String(vrm?.meta?.metaVersion??vrm?.meta?.specVersion??'unknown')}}"
    out = replace_once(out, old_publish, new_publish, 'publish')

    old_load_marker = "vrm=gltf.userData.vrm;if(!vrm)throw Error('未发现 VRM 数据');"
    new_load_marker = "vrm=gltf.userData.vrm;v48Reset(clock.elapsedTime);if(!vrm)throw Error('未发现 VRM 数据');"
    out = replace_once(out, old_load_marker, new_load_marker, 'reset after load')

    old_animate = extract(out, 'function animate(t,dt)', 'function resize()')
    out = out.replace(old_animate, V48_ANIMATE, 1)

    old_pointer = "addEventListener('pointermove',e=>{pointer.x=e.clientX/innerWidth*2-1;pointer.y=-(e.clientY/innerHeight*2-1)})"
    new_pointer = "addEventListener('pointermove',e=>{pointer.x=e.clientX/innerWidth*2-1;pointer.y=-(e.clientY/innerHeight*2-1);pointer.last=clock.elapsedTime})"
    out = replace_once(out, old_pointer, new_pointer, 'pointer timestamp')
    return out


def frozen_hashes(source: str) -> dict[str, str]:
    blocks = {
        'poses': extract(source, 'const poses=', 'function publish'),
        'materials': extract(source, 'function v47SetColor', 'function bone(n)'),
        'fit': extract(source, 'function fit()', 'function bounds()'),
        'frame': extract(source, 'async function frame()', 'function schedule()'),
        'css': extract(source, '<style>', '</style>'),
    }
    return {key: hashlib.sha256(value.encode()).hexdigest() for key, value in blocks.items()}


def main() -> None:
    source = read_source()
    html = build(source)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'index.html').write_text(html, encoding='utf-8')
    meta = {
        'buildId': BUILD_ID,
        'bytes': len(html.encode()),
        'sha256': hashlib.sha256(html.encode()).hexdigest(),
        'sourceSha256': hashlib.sha256(source.encode()).hexdigest(),
        'frozenSource': frozen_hashes(source),
        'frozenOutput': frozen_hashes(html),
    }
    (OUT / 'metadata.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')
    print(json.dumps(meta, indent=2))


if __name__ == '__main__':
    main()
