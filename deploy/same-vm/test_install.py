import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("lab_install", Path(__file__).with_name("install.py"))
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)
SITE = """server {
    server_name playonline.muorigins.online;
    root /opt/muorigins/mu-online-solo-classic/web;
    location / { try_files $uri $uri/ =404; }
    listen 443 ssl;
}
server {
    server_name playonline.muorigins.online;
    listen 80;
    return 404;
}
"""


class InstallationTests(unittest.TestCase):
    def test_preserves_existing_routes_and_root(self):
        result = lab.candidate(SITE)
        self.assertEqual(result.replace(lab.INCLUDE + "\n", ""), SITE)

    def test_remove_only_lab_include(self):
        self.assertEqual(lab.candidate(lab.candidate(SITE), True), SITE)

    def test_reject_changed_site_and_duplicate_install(self):
        for text in [SITE.replace("mu-online-solo-classic", "other"), SITE + SITE,
                     SITE.replace("listen 443 ssl", "listen 8443 ssl"), lab.candidate(SITE),
                     SITE.replace("location /", "location /network-lab/")]:
            with self.assertRaises(ValueError):
                lab.candidate(text)

    def test_failed_validation_restores_original_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "site"
            target.write_bytes(SITE.encode())
            def fail():
                raise RuntimeError("nginx test failure")
            with self.assertRaises(RuntimeError):
                lab.change_site(target, lab.candidate(SITE), Path(directory) / "backups", fail)
            self.assertEqual(target.read_bytes(), SITE.encode())
            self.assertEqual(len(list((Path(directory) / "backups").glob("*.bak"))), 1)

    def test_success_keeps_backup_and_new_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "site"
            target.write_bytes(SITE.encode())
            backup = lab.change_site(target, lab.candidate(SITE), Path(directory) / "backups", lambda: None)
            self.assertEqual(backup.read_bytes(), SITE.encode())
            self.assertIn(lab.INCLUDE, target.read_text())


if __name__ == "__main__":
    unittest.main()
