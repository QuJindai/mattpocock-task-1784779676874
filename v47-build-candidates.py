from __future__ import annotations

import base64
import gzip
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(os.environ.get('V47_REPO_ROOT', '.')).resolve()
OUT = ROOT / 'v47-site'


def read_source() -> str:
    explicit = os.environ.get('V47_SOURCE_HTML')
    if explicit:
        return Path(explicit).read_text(encoding='utf-8')
    blocks = sorted((ROOT / 'payloads' / 'v46').glob('payload-*.txt'))
    if not blocks:
        raise FileNotFoundError('No V4.6 payload blocks and V47_SOURCE_HTML is unset')
    encoded = ''.join(p.read_text(encoding='utf-8').strip() for p in blocks)
    return gzip.decompress(base64.b64decode(encoded)).decode('utf-8')


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise ValueError(f'{label}: expected one match, found {count}')
    return source.replace(old, new, 1)


def extract(source: str, start: str, end: str) -> str:
    a = source.index(start)
    b = source.index(end, a)
    return source[a:b]


COMMON_HELPERS = r'''function v47SetColor(target,value){if(target&&typeof target.set==='function')target.set(value)}
function v47TuneMToon(m,n,outline){
  if('emissiveIntensity'in m){
    if(outline)m.emissiveIntensity=0;
    else if(n.includes('_SKIN'))m.emissiveIntensity=.045;
    else if(n.includes('Tops_01_CLOTH'))m.emissiveIntensity=.065;
    else if(n.includes('_HAIR_'))m.emissiveIntensity=.075;
    else if(n.includes('_EYE')||n.includes('FaceEye'))m.emissiveIntensity=.15;
    else m.emissiveIntensity=Math.min(m.emissiveIntensity||0,.10)
  }
  if(!outline&&n.includes('_SKIN')){
    if(m.color)v47SetColor(m.color,'#fff1ea');v47SetColor(m.shadeColorFactor,'#cf8e89');v47SetColor(m.rimColorFactor,'#ffd2c3');
    if('shadingShiftFactor'in m)m.shadingShiftFactor=-.075;if('shadingToonyFactor'in m)m.shadingToonyFactor=.68;
    if('rimLightingMixFactor'in m)m.rimLightingMixFactor=.18;if('rimFresnelPowerFactor'in m)m.rimFresnelPowerFactor=3.6;if('parametricRimLiftFactor'in m)m.parametricRimLiftFactor=.08;
  }else if(!outline&&n.includes('Tops_01_CLOTH')){
    if(m.color)v47SetColor(m.color,'#fff4e8');v47SetColor(m.shadeColorFactor,'#a87961');v47SetColor(m.rimColorFactor,'#eed2b5');
    if('shadingShiftFactor'in m)m.shadingShiftFactor=-.12;if('shadingToonyFactor'in m)m.shadingToonyFactor=.64;
    if('rimLightingMixFactor'in m)m.rimLightingMixFactor=.12;if('rimFresnelPowerFactor'in m)m.rimFresnelPowerFactor=3.8;
  }else if(!outline&&n.includes('_HAIR_')){
    if(m.color)v47SetColor(m.color,'#b18479');v47SetColor(m.shadeColorFactor,'#2c1216');v47SetColor(m.rimColorFactor,'#9f6858');
    if('shadingShiftFactor'in m)m.shadingShiftFactor=-.10;if('shadingToonyFactor'in m)m.shadingToonyFactor=.58;
    if('rimLightingMixFactor'in m)m.rimLightingMixFactor=.44;if('rimFresnelPowerFactor'in m)m.rimFresnelPowerFactor=2.8;if('parametricRimLiftFactor'in m)m.parametricRimLiftFactor=.14;
  }
  m.toneMapped=true;m.needsUpdate=true
}
function v47Hsl(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn,l=(mx+mn)/2;let h=0,s=0;if(d){s=d/(1-Math.abs(2*l-1));if(mx===r)h=((g-b)/d)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h/=6;if(h<0)h+=1}return[h,s,l]}
function v47Rgb(h,s,l){const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h*6)%2-1)),m=l-c/2;let r=0,g=0,b=0;const q=Math.floor(h*6)%6;if(q===0){r=c;g=x}else if(q===1){r=x;g=c}else if(q===2){g=c;b=x}else if(q===3){g=x;b=c}else if(q===4){r=x;b=c}else{r=c;b=x}return[Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)]}
function v47CloneTexture(tex,mode){
  const img=tex?.image;if(!img||!img.width||!img.height)return tex;const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(img,0,0);const im=x.getImageData(0,0,c.width,c.height),d=im.data;
  for(let i=0;i<d.length;i+=4){if(d[i+3]<8)continue;const r=d[i],g=d[i+1],b=d[i+2],[h,s,l]=v47Hsl(r,g,b);
    if(mode==='hair'){const rgb=v47Rgb(.045,Math.min(.62,Math.max(.34,s*.82)),Math.min(.72,Math.max(.045,l*.80+.018)));d[i]=rgb[0];d[i+1]=rgb[1];d[i+2]=rgb[2]}
    else{const blue=b>r*1.10&&b>g*1.06&&s>.18,dark=l<.25,button=r>g*1.13&&g>b*1.12&&l<.58;if(!blue&&!dark&&!button&&l>.36){const shade=Math.min(.99,Math.max(.32,l*1.02+.07));d[i]=Math.round(255*shade);d[i+1]=Math.round(242*shade);d[i+2]=Math.round(221*shade)}}
  }
  x.putImageData(im,0,0);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.flipY=tex.flipY;t.wrapS=tex.wrapS;t.wrapT=tex.wrapT;t.magFilter=tex.magFilter;t.minFilter=tex.minFilter;t.anisotropy=tex.anisotropy;t.offset.copy(tex.offset);t.repeat.copy(tex.repeat);t.center.copy(tex.center);t.rotation=tex.rotation;t.name=tex.name+'-v47-'+mode;t.needsUpdate=true;return t
}
'''


def tune_function(texture_recolor: bool) -> str:
    recolor = r'''const mode=n.includes('_HAIR_')?'hair':n.includes('Tops_01_CLOTH')?'cardigan':null;if(mode){const original=m.map||m.shadeMultiplyTexture;if(original){const key=original.uuid+':'+mode;let refined=textureCache.get(key);if(!refined){refined=v47CloneTexture(original,mode);textureCache.set(key,refined)}if(m.map)m.map=refined;if('shadeMultiplyTexture'in m)m.shadeMultiplyTexture=refined;v47Report.textures[mode]=(v47Report.textures[mode]||0)+1}}''' if texture_recolor else ''
    return COMMON_HELPERS + "\n" + (
        "async function tune(root){const textureCache=new Map();v47Report.materials={};v47Report.textures={};root.traverse(o=>{if(!o.isMesh)return;o.castShadow=true;o.frustumCulled=false;for(const m of(Array.isArray(o.material)?o.material:[o.material]))if(m){const n=m.name||'',outline=n.includes('(Outline)');v47TuneMToon(m,n,outline);"
        + recolor
        + "if(!outline){if(n.includes('_SKIN'))v47Report.materials.skin={emissive:m.emissiveIntensity,shade:m.shadeColorFactor?.getHexString?.(),toony:m.shadingToonyFactor};else if(n.includes('Tops_01_CLOTH'))v47Report.materials.cardigan={emissive:m.emissiveIntensity,shade:m.shadeColorFactor?.getHexString?.(),toony:m.shadingToonyFactor};else if(n.includes('_HAIR_'))v47Report.materials.hair={emissive:m.emissiveIntensity,shade:m.shadeColorFactor?.getHexString?.(),rim:m.rimColorFactor?.getHexString?.()}}}});v47Report.ready=true}"
    )


def make_candidate(source: str, key: str, label: str, recolor: bool, integrated: bool) -> str:
    out = source
    out = out.replace('VRM Showcase Lab V4.6', f'VRM Showcase Lab V4.7 {key.upper()}')
    out = out.replace('V4.5 · Avatar A / Night Apartment', f'V4.7 {key.upper()} · Avatar A / Night Apartment')
    out = out.replace('<h1>Alicia<br>夜景公寓氛围</h1>', f'<h1>Avatar A<br>{label}</h1>')
    out = out.replace('暖色室内主光、冷色窗外轮廓光与程序化夜景公寓。角色、动作和取景保持 V4.4 基线。', '脸部、头发、开衫与背景融合精修。角色、动作和取景保持 V4.6 基线。')
    out = replace_once(out, "visual-avatar-a-v4-6-20260805", f"visual-avatar-a-v4-7-{key}-20260805", 'build id')
    out = replace_once(out, "let vrm=null,modelHeight=1.6,fitDebug=null,pointer={x:0,y:0},blink=0,frameToken=0,timers=[];", "const v47Report={candidate:'"+key+"',ready:false,materials:{},textures:{},integration:"+('true' if integrated else 'false')+"};let vrm=null,modelHeight=1.6,fitDebug=null,pointer={x:0,y:0},blink=0,frameToken=0,timers=[];", 'v47 report')
    out = replace_once(out, "fitDebug,metaVersion:String", "fitDebug,v47:v47Report,metaVersion:String", 'publish report')
    old_tune = extract(out, 'function tune(root)', 'function bone(n)')
    out = out.replace(old_tune, tune_function(recolor), 1)
    out = replace_once(out, 'tune(vrm.scene);scene.add(vrm.scene);', 'await tune(vrm.scene);scene.add(vrm.scene);', 'await tune')
    if integrated:
        extra_css = '''.bg .city{filter:blur(1.25px) saturate(.82) brightness(.82) drop-shadow(0 -8px 22px rgba(73,88,181,.18));transform:scale(1.025);transform-origin:bottom}.bg .sofa{filter:blur(.65px) saturate(.78) brightness(.82)}.bg .plant{filter:blur(.8px) saturate(.72);opacity:.82}.bg .night-window{filter:saturate(.9) brightness(.88)}.bg .foreground{filter:blur(5px)}#canvas{filter:drop-shadow(0 18px 27px rgba(0,0,0,.34)) drop-shadow(-5px 0 17px rgba(255,143,83,.09)) drop-shadow(7px 0 18px rgba(84,126,230,.08))}.character-halo{position:absolute;z-index:-1;left:50%;top:48%;width:460px;height:610px;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(ellipse,rgba(255,176,122,.13),rgba(84,126,230,.045) 48%,transparent 72%);filter:blur(24px);pointer-events:none}.character-contact{position:absolute;z-index:-1;left:50%;bottom:1.5%;width:410px;height:76px;transform:translateX(-50%);border-radius:50%;background:rgba(0,0,0,.36);filter:blur(19px);pointer-events:none}'''
        out = replace_once(out, '</style><script type="importmap">', extra_css+'</style><script type="importmap">', 'integration css')
        out = replace_once(out, '</div><canvas id="canvas"></canvas><header class="bar">', '</div><div class="character-halo"></div><div class="character-contact"></div><canvas id="canvas"></canvas><header class="bar">', 'integration layers')
        out = replace_once(out, 'new THREE.MeshBasicMaterial({color:0,transparent:true,opacity:.2,depthWrite:false})', 'new THREE.MeshBasicMaterial({color:0,transparent:true,opacity:.3,depthWrite:false})', 'contact shadow opacity')
    return out


def main() -> None:
    source = read_source()
    required = ['visual-avatar-a-v4-6-20260805', 'const poses=', 'function fit()', 'function frame()', 'function animate']
    for marker in required:
        if marker not in source:
            raise ValueError(f'Missing source marker: {marker}')
    OUT.mkdir(parents=True, exist_ok=True)
    variants = {
        'a': ('TOON DEPTH', False, False),
        'b': ('TEXTURE RECOLOR', True, False),
        'c': ('INTEGRATED REFINEMENT', True, True),
    }
    manifest = {'source_sha256': hashlib.sha256(source.encode()).hexdigest(), 'variants': {}}
    for key, (label, recolor, integrated) in variants.items():
        html = make_candidate(source, key, label, recolor, integrated)
        path = OUT / f'{key}.html'
        path.write_text(html, encoding='utf-8')
        manifest['variants'][key] = {
            'label': label,
            'sha256': hashlib.sha256(html.encode()).hexdigest(),
            'bytes': len(html.encode()),
            'recolor': recolor,
            'integrated': integrated,
        }
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
