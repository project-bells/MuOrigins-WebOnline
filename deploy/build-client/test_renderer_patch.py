import importlib.util
from pathlib import Path
import sys
import unittest

spec = importlib.util.spec_from_file_location("renderer_patch", Path(__file__).with_name("renderer_patch.py"))
patcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patcher)


class RendererPatchTests(unittest.TestCase):
    def test_reads_inline_and_here_literals_and_exact_counts(self):
        source = 'Replace-Once $js "a`nb" @"\nx``y\n"@\nReplace-Count $js @\'\nold\n\'@ @\'\nnew\n\'@ 2\n'
        rules = patcher.rules_from_source(source)
        self.assertEqual(rules, [("a\nb", "x`y", 1), ("old", "new", 2)])
        self.assertEqual(patcher.apply_rules("a\nb old old", rules), "x`y new new")

    def test_mismatch_does_not_return_partially_patched_output(self):
        with self.assertRaises(ValueError):
            patcher.apply_rules("one", [("one", "two", 1), ("missing", "new", 1)])

    def test_interpolation_is_not_evaluated(self):
        with self.assertRaises(ValueError):
            patcher.rules_from_source('Replace-Once $js "$unsafe" "x"\n')


if __name__ == "__main__":
    unittest.main()
