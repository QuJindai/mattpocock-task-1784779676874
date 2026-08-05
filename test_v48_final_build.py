import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('v48_final', ROOT / 'v48-build-final.py')
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)
SOURCE = MOD.base.read_source()


class V48FinalBuildTests(unittest.TestCase):
    def test_exposes_deterministic_runtime_interface(self):
        html = MOD.build(SOURCE)
        self.assertIn('function v48Step(t,dt)', html)
        self.assertIn('function v48SetPointer(x,y,t)', html)
        self.assertIn('stepV48:v48Step', html)
        self.assertIn('resetV48:v48Reset', html)
        self.assertIn('setV48Pointer:v48SetPointer', html)

    def test_step_uses_real_animation_and_spring_update(self):
        html = MOD.build(SOURCE)
        self.assertIn('animate(t,dt);if(vrm)vrm.update(dt)', html)

    def test_frozen_visual_blocks_remain_identical(self):
        html = MOD.build(SOURCE)
        self.assertEqual(MOD.base.frozen_hashes(SOURCE), MOD.base.frozen_hashes(html))

    def test_no_duplicate_runtime_interface(self):
        html = MOD.build(SOURCE)
        self.assertEqual(html.count('function v48Step(t,dt)'), 1)
        self.assertEqual(html.count('stepV48:v48Step'), 1)


if __name__ == '__main__':
    unittest.main()
