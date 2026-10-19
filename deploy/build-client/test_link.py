import importlib.util
from pathlib import Path
import tempfile
import types
import unittest

spec = importlib.util.spec_from_file_location("link_checkpoint", Path(__file__).with_name("link.py"))
linker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(linker)


class LinkSupplementTests(unittest.TestCase):
    def test_adds_missing_font_object_with_existing_compile_flags(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "client"
            source = root / "browser/mu_gdi.cpp"
            source.parent.mkdir(parents=True)
            source.write_text("// fixture")
            release = Path(directory) / "release"
            release.mkdir()
            calls = []
            def run(command, **kwargs):
                calls.append(command)
                Path(command[command.index("-o") + 1]).write_bytes(b"fixture-object")
                return types.SimpleNamespace(returncode=0)
            result = linker.compile_supplements(root, release, types.SimpleNamespace(FLAGS=["-c", "-O2"]), [], run)
            self.assertEqual(len(result), 1)
            self.assertIn("-c", calls[0])
            self.assertIn(str(source), calls[0])
            self.assertEqual(Path(result[0]).name, "mu_gdi.cpp.o")

    def test_failed_supplement_stops_before_link(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "browser").mkdir()
            (root / "browser/mu_gdi.cpp").write_text("// fixture")
            with self.assertRaisesRegex(RuntimeError, "compilation failed"):
                linker.compile_supplements(root, root, types.SimpleNamespace(FLAGS=["-c"]), [],
                                           lambda *args, **kwargs: types.SimpleNamespace(returncode=1))

    def test_existing_font_translation_unit_is_not_linked_twice(self):
        result = linker.compile_supplements(Path("unused"), Path("unused"), None,
                                            [("browser/mu_gdi.cpp", "browser/mu_gdi.cpp.o")],
                                            lambda *args, **kwargs: self.fail("must not compile twice"))
        self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
