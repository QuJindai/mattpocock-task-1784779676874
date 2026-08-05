from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path

ROOT = Path(os.environ.get('V48_REPO_ROOT', '.')).resolve()
OUT = ROOT / 'v48-site'
BASE_PATH = ROOT / 'v48-build.py'

spec = importlib.util.spec_from_file_location('v48_base', BASE_PATH)
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

STEP_HELPERS = """function v48SetPointer(x,y,t){pointer.x=x;pointer.y=y;pointer.last=t}\nfunction v48Step(t,dt){animate(t,dt);if(vrm)vrm.update(dt);return v48Report}\n"""


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise ValueError(f'{label}: expected 1 match, found {count}')
    return source.replace(old, new, 1)


def build(source: str) -> str:
    html = base.build(source)
    html = replace_once(
        html,
        'function v48Rand(i){',
        STEP_HELPERS + 'function v48Rand(i){',
        'deterministic step helpers',
    )
    html = replace_once(
        html,
        'v47:v47Report,v48:v48Report,metaVersion:',
        'v47:v47Report,v48:v48Report,stepV48:v48Step,resetV48:v48Reset,setV48Pointer:v48SetPointer,metaVersion:',
        'published deterministic interface',
    )
    return html


def main() -> None:
    source = base.read_source()
    html = build(source)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'index.html').write_text(html, encoding='utf-8')
    meta = {
        'buildId': base.BUILD_ID,
        'bytes': len(html.encode()),
        'sha256': hashlib.sha256(html.encode()).hexdigest(),
        'sourceSha256': hashlib.sha256(source.encode()).hexdigest(),
        'frozenSource': base.frozen_hashes(source),
        'frozenOutput': base.frozen_hashes(html),
        'deterministicInterface': ['stepV48', 'resetV48', 'setV48Pointer'],
    }
    if meta['frozenSource'] != meta['frozenOutput']:
        raise AssertionError('V4.7 frozen visual blocks changed')
    (OUT / 'metadata.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')
    print(json.dumps(meta, indent=2))


if __name__ == '__main__':
    main()
