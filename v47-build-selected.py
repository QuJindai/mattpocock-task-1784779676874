from __future__ import annotations
import hashlib, importlib.util, json, os
from pathlib import Path

ROOT=Path(os.environ.get('V47_REPO_ROOT','.')).resolve()
spec=importlib.util.spec_from_file_location('v47_candidates',ROOT/'v47-build-candidates.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
source=mod.read_source()
html=mod.make_candidate(source,'d','SELECTED HYBRID',False,True)
html=html.replace('visual-avatar-a-v4-7-d-20260805','visual-avatar-a-v4-7-20260805')
html=html.replace("v47SetColor(m.color,'#fff4e8')","v47SetColor(m.color,'#d5eee6')")
html=html.replace("v47SetColor(m.color,'#b18479')","v47SetColor(m.color,'#aa8178')")
html=html.replace("v47SetColor(m.rimColorFactor,'#9f6858')","v47SetColor(m.rimColorFactor,'#7f574d')")
html=html.replace("m.rimLightingMixFactor=.44","m.rimLightingMixFactor=.34")
html=html.replace("v47Report.materials.skin={emissive:m.emissiveIntensity,shade:m.shadeColorFactor?.getHexString?.(),toony:m.shadingToonyFactor}","v47Report.materials.skin={color:m.color?.getHexString?.(),emissive:m.emissiveIntensity,shade:m.shadeColorFactor?.getHexString?.(),toony:m.shadingToonyFactor}")
html=html.replace("v47Report.materials.cardigan={emissive:m.emissiveIntensity,shade:m.shadeColorFactor?.getHexString?.(),toony:m.shadingToonyFactor}","v47Report.materials.cardigan={color:m.color?.getHexString?.(),emissive:m.emissiveIntensity,shade:m.shadeColorFactor?.getHexString?.(),toony:m.shadingToonyFactor}")
html=html.replace("v47Report.materials.hair={emissive:m.emissiveIntensity,shade:m.shadeColorFactor?.getHexString?.(),rim:m.rimColorFactor?.getHexString?.()}","v47Report.materials.hair={color:m.color?.getHexString?.(),emissive:m.emissiveIntensity,shade:m.shadeColorFactor?.getHexString?.(),rim:m.rimColorFactor?.getHexString?.()}")
html=html.replace('V4.7 D · Avatar A / Night Apartment','V4.7 · Avatar A / Night Apartment')
html=html.replace('VRM Showcase Lab V4.7 D','VRM Showcase Lab V4.7')
assert 'visual-avatar-a-v4-7-20260805' in html
assert "v47SetColor(m.color,'#d5eee6')" in html
assert "v47SetColor(m.color,'#aa8178')" in html
assert "v47SetColor(m.rimColorFactor,'#7f574d')" in html
assert 'v47CloneTexture(original,mode)' not in html
assert 'character-halo' in html
out=ROOT/'v47-selected-site';out.mkdir(parents=True,exist_ok=True)
(out/'index.html').write_text(html,encoding='utf-8')
meta={'buildId':'visual-avatar-a-v4-7-20260805','sha256':hashlib.sha256(html.encode()).hexdigest(),'bytes':len(html.encode()),'source':'V4.6 immutable payload','candidate':'D selected hybrid'}
(out/'metadata.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
print(json.dumps(meta,indent=2))
