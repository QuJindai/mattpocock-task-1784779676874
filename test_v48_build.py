import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('v48_build', ROOT / 'v48-build.py')
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)
SOURCE = MOD.read_source()


class V48BuildTests(unittest.TestCase):
    def test_build_adds_liveliness_contract(self):
        out = MOD.build(SOURCE)
        self.assertIn(MOD.BUILD_ID, out)
        self.assertIn("version:'liveliness-v1'", out)
        self.assertIn('v48BlinkTarget', out)
        self.assertIn('v48ScheduleBlink', out)
        self.assertIn('v48Reset(clock.elapsedTime)', out)
        self.assertIn('blink.history.push(interval)', out)
        self.assertIn('pointer.last=clock.elapsedTime', out)
        self.assertIn('Boolean(vrm.springBoneManager)', out)
        self.assertIn('v48:v48Report', out)

    def test_frozen_visual_blocks_are_identical(self):
        out = MOD.build(SOURCE)
        self.assertEqual(MOD.frozen_hashes(SOURCE), MOD.frozen_hashes(out))

    def test_no_direct_hair_bone_mutation(self):
        out = MOD.build(SOURCE)
        animate = MOD.extract(out, 'function animate(t,dt)', 'function resize()')
        self.assertNotIn("getnormalizedbonenode('hair", animate.lower())
        self.assertNotIn("getrawbonenode('hair", animate.lower())
        self.assertIn('vrm.springBoneManager', animate)

    def test_motion_limits_encoded(self):
        out = MOD.build(SOURCE)
        animate = MOD.extract(out, 'function animate(t,dt)', 'function resize()')
        for value in ['*.014', '*.0045', '*.006', '*.028', '*.13']:
            self.assertIn(value, animate)

    def test_hips_preserve_rest_translation(self):
        out = MOD.build(SOURCE)
        self.assertIn("baseHipsY=hips?.position.y??0", out)
        self.assertIn('v48Motion.baseHipsY+breath*.0045', out)
        self.assertIn('motion.hipOffset=', out)

    def test_first_blink_interval_and_double_freeze(self):
        out = MOD.build(SOURCE)
        self.assertIn('nextBlink:1.85', out)
        self.assertIn('2.2+v48Rand(v48Motion.blinkIndex)*3.2', out)
        self.assertIn('v48Motion.blinkIndex%4===0', out)
        self.assertIn('v48Motion.nextBlink=Infinity', out)
        self.assertIn('if(v48Motion.isDouble)', out)


if __name__ == '__main__':
    unittest.main()
