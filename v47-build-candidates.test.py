from __future__ import annotations

import hashlib
import os
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(os.environ.get('V47_REPO_ROOT', '.')).resolve()
SOURCE = Path(os.environ.get('V47_TEST_SOURCE', ROOT / 'v47-source.html'))
if not SOURCE.exists():
    blocks = sorted((ROOT / 'payloads' / 'v46').glob('payload-*.txt'))
    if not blocks:
        raise FileNotFoundError('V4.6 source unavailable')
    import base64, gzip
    encoded=''.join(p.read_text().strip() for p in blocks)
    SOURCE.write_text(gzip.decompress(base64.b64decode(encoded)).decode())

with tempfile.TemporaryDirectory() as td:
    root = Path(td)
    env = os.environ.copy()
    env['V47_REPO_ROOT'] = str(root)
    env['V47_SOURCE_HTML'] = str(SOURCE)
    subprocess.run(['python', str(ROOT / 'v47-build-candidates.py')], env=env, check=True, capture_output=True, text=True)
    source = SOURCE.read_text()

    def section(s: str, a: str, b: str) -> str:
        i = s.index(a)
        j = s.index(b, i)
        return s[i:j]

    locked = {
        'poses': hashlib.sha256(section(source, 'const poses=', 'function publish').encode()).hexdigest(),
        'fit': hashlib.sha256(section(source, 'function fit()', 'function bounds()').encode()).hexdigest(),
        'frame': hashlib.sha256(section(source, 'async function frame()', 'function schedule()').encode()).hexdigest(),
        'animate': hashlib.sha256(section(source, 'function animate', 'function resize()').encode()).hexdigest(),
    }

    for key in 'abc':
        path = root / 'v47-site' / f'{key}.html'
        assert path.exists(), path
        html = path.read_text()
        assert f'visual-avatar-a-v4-7-{key}-20260805' in html
        assert 'AvatarSample_A.vrm' in html
        assert hashlib.sha256(section(html, 'const poses=', 'function publish').encode()).hexdigest() == locked['poses']
        assert hashlib.sha256(section(html, 'function fit()', 'function bounds()').encode()).hexdigest() == locked['fit']
        assert hashlib.sha256(section(html, 'async function frame()', 'function schedule()').encode()).hexdigest() == locked['frame']
        assert hashlib.sha256(section(html, 'function animate', 'function resize()').encode()).hexdigest() == locked['animate']
        script = re.search(r'<script type="module">(.*?)</script>', html, re.S).group(1)
        js = root / f'{key}.mjs'
        js.write_text(script)
        subprocess.run(['node', '--check', str(js)], check=True, capture_output=True, text=True)
        assert 'v47Report' in html and 'await tune(vrm.scene)' in html

    a = (root / 'v47-site/a.html').read_text()
    b = (root / 'v47-site/b.html').read_text()
    c = (root / 'v47-site/c.html').read_text()
    assert 'v47CloneTexture(original,mode)' not in a
    assert 'v47CloneTexture(original,mode)' in b
    assert 'character-halo' not in b
    assert 'character-halo' in c and 'drop-shadow(0 18px 27px' in c

print('V47_CANDIDATE_GENERATOR_TEST_PASS')
