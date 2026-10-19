import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("client_compile", Path(__file__).with_name("compile.py"))
compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)


class CompilePlanTests(unittest.TestCase):
    def make_tree(self, directory, entries):
        root = Path(directory)
        for entry in ["src/a.cpp", "src/a.c", *compiler.EXTRA]:
            file = root / entry
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("// fixture")
        (root / "m2-sources.txt").write_text("\n".join(entries))
        return root

    def test_deduplicates_and_keeps_c_cpp_object_names_separate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.make_tree(directory, ["src/a.cpp", "src/a.c", "src/a.cpp"])
            plan = compiler.source_plan(root)
            self.assertEqual(len(plan), 2 + len(compiler.EXTRA))
            self.assertNotEqual(plan[0][1], plan[1][1])

    def test_rejects_escape_absolute_and_missing_sources(self):
        for entry in ["../escape.cpp", "/tmp/file.cpp", "src/missing.cpp", "src/a.exe"]:
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(ValueError):
                    compiler.source_plan(self.make_tree(directory, [entry]))

    def test_gl_shims_cover_windows_case_spellings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            compiler.create_gl_shims(root)
            for name in ["gl.h", "GL.h", "glu.h", "GLU.h"]:
                self.assertIn("#include <GL/", (root / "gl" / name).read_text())


if __name__ == "__main__":
    unittest.main()
