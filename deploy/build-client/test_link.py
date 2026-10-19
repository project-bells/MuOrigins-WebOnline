import importlib.util
from pathlib import Path
import tempfile
import types
import unittest

spec = importlib.util.spec_from_file_location("link_checkpoint", Path(__file__).with_name("link.py"))
linker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(linker)


class LinkSupplementTests(unittest.TestCase):
    def test_opengl_cleanup_preserves_sound_context_and_cursor_order(self):
        definition = "void OpenGL_Release(void)\n{\n    // cleanup\n    FreeDirectSound();\n    gWindow.ReleaseOpenGL();\n    ShowCursor(1);\n}\n"
        self.assertEqual(linker.extract_opengl_release(definition), definition)

    def test_changed_opengl_cleanup_requires_review(self):
        with self.assertRaisesRegex(RuntimeError, "requires review"):
            linker.extract_opengl_release("void OpenGL_Release(void)\n{\n    ShowCursor(1);\n}\n")

    def test_watchdog_copies_upstream_definition_only(self):
        definition = "void GameGuard_TickCheck(void)\n{\n    // upstream disabled\n}\n"
        self.assertEqual(linker.extract_tick_check("void GameGuard_TickCheck(void);\n" + definition), definition)

    def test_watchdog_rejects_active_native_code(self):
        with self.assertRaisesRegex(RuntimeError, "requires review"):
            linker.extract_tick_check("void GameGuard_TickCheck(void)\n{\n    native_check();\n}\n")

    def test_watchdog_missing_definition_stops_build(self):
        with self.assertRaisesRegex(RuntimeError, "Expected one"):
            linker.extract_tick_check("void GameGuard_TickCheck(void);\n")

    def test_adds_both_runtime_objects_with_existing_compile_flags(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "client"
            for entry in linker.LINK_SUPPLEMENTS:
                source = root / entry
                source.parent.mkdir(parents=True, exist_ok=True)
                source.write_text("// fixture")
            release = Path(directory) / "release"
            release.mkdir()
            calls = []
            def run(command, **kwargs):
                calls.append(command)
                Path(command[command.index("-o") + 1]).write_bytes(b"fixture-object")
                return types.SimpleNamespace(returncode=0)
            result = linker.compile_supplements(root, release, types.SimpleNamespace(FLAGS=["-c", "-O2"]), [], run)
            self.assertEqual(len(result), 2)
            self.assertIn("-c", calls[0])
            self.assertEqual({Path(file).name for file in result}, {"mu_gdi.cpp.o", "mu_profile.cpp.o"})
            self.assertEqual({command[-3] for command in calls}, {str(root / entry) for entry in linker.LINK_SUPPLEMENTS})

    def test_failed_supplement_stops_before_link(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "browser").mkdir()
            (root / "browser/mu_gdi.cpp").write_text("// fixture")
            with self.assertRaisesRegex(RuntimeError, "compilation failed"):
                linker.compile_supplements(root, root, types.SimpleNamespace(FLAGS=["-c"]), [],
                                           lambda *args, **kwargs: types.SimpleNamespace(returncode=1))

    def test_existing_runtime_translation_units_are_not_linked_twice(self):
        result = linker.compile_supplements(Path("unused"), Path("unused"), None,
                                            [(entry, entry + ".o") for entry in linker.LINK_SUPPLEMENTS],
                                            lambda *args, **kwargs: self.fail("must not compile twice"))
        self.assertEqual(result, [])

    def test_all_active_browser_support_files_are_accounted_for(self):
        self.assertEqual(set(linker.BROWSER_RUNTIME_SOURCES), {
            "browser/shell_login.cpp", "browser/net_ws.cpp", "browser/mu_mesh_draw.cpp",
            "browser/mu_gdi.cpp", "browser/mu_profile.cpp"})
        self.assertTrue(set(linker.LINK_SUPPLEMENTS).issubset(linker.BROWSER_RUNTIME_SOURCES))


if __name__ == "__main__":
    unittest.main()
