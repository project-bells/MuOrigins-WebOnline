#!/usr/bin/env python3
"""Install/remove protected mock test routes on the previously inspected VM."""
import datetime
import getpass
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import urllib.request

HOST = "instance-20261017-074800"
SITE = Path("/etc/nginx/sites-enabled/playonline.muorigins.online")
ANCHOR = "    root /opt/muorigins/mu-online-solo-classic/web;"
INCLUDE = "    include /etc/nginx/snippets/muweb-lab.conf;"
HERE = Path(__file__).resolve().parent


def candidate(text, remove=False):
    if len(re.findall(r"server_name\s+playonline\.muorigins\.online\s*;", text)) != 2:
        raise ValueError("Unexpected server_name layout; no configuration changed")
    if text.count(ANCHOR) != 1 or "listen 443 ssl" not in text:
        raise ValueError("Unexpected website root/TLS layout; no configuration changed")
    if text.count(INCLUDE) > 1:
        raise ValueError("Duplicate lab include; inspect manually")
    if remove:
        return text.replace(INCLUDE + "\n", "")
    if INCLUDE in text:
        raise ValueError("Lab include already installed; no configuration changed")
    if "/network-lab/" in text:
        raise ValueError("Existing lab routes require manual review")
    return text.replace(ANCHOR, INCLUDE + "\n" + ANCHOR)


def change_site(target, new_text, backup_dir, check_and_reload):
    original = target.read_bytes()
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    backup = backup_dir / (target.name + "." + stamp + ".bak")
    shutil.copy2(target, backup)
    try:
        target.write_bytes(new_text.encode("utf-8"))
        check_and_reload()
    except BaseException:
        target.write_bytes(original)
        raise
    return backup


def main():
    if os.geteuid() != 0:
        raise RuntimeError("Run with sudo python3 deploy/same-vm/install.py")
    if socket.gethostname().split(".")[0] != HOST:
        raise RuntimeError("VM hostname differs from the inspected VM; stopping")
    if sys.argv[1:] not in ([], ["--remove"]):
        raise RuntimeError("Supported option: --remove")
    remove = "--remove" in sys.argv[1:]
    target = SITE.resolve(strict=True)
    text = target.read_text(encoding="utf-8")
    new_text = candidate(text, remove)
    if new_text == text:
        print("Lab routes already disabled")
        return
    subprocess.run(["nginx", "-t"], check=True)
    if not remove:
        with urllib.request.urlopen("http://127.0.0.1:18081/healthz", timeout=5) as response:
            if response.read() != b"ok":
                raise RuntimeError("Lab gateway health check failed")
        import pwd
        config = subprocess.run(["nginx", "-T"], capture_output=True, text=True, check=True).stdout
        worker = re.search(r"^\s*user\s+([^\s;]+)", config, re.MULTILINE)
        if not worker:
            raise RuntimeError("Cannot identify Nginx worker account")
        gid = pwd.getpwnam(worker.group(1)).pw_gid
        auth = Path("/etc/nginx/muweb-lab.htpasswd")
        snippet = Path("/etc/nginx/snippets/muweb-lab.conf")
        page = Path("/srv/muweb-lab/smoke.html")
        if any(p.exists() for p in (auth, snippet, page)):
            raise RuntimeError("Lab files already exist; refusing to overwrite them")
        password = getpass.getpass("New lab password (user: muwebtest): ")
        if len(password) < 12 or "\n" in password or "\r" in password:
            raise RuntimeError("Use a new password of at least 12 characters")
        if password != getpass.getpass("Repeat lab password: "):
            raise RuntimeError("Passwords differ")
        hashed = subprocess.run(["openssl", "passwd", "-6", "-stdin"], input=password + "\n",
                                capture_output=True, text=True, check=True).stdout.strip()
        del password
        if not hashed.startswith("$6$"):
            raise RuntimeError("Unexpected password hash")
        snippet.parent.mkdir(parents=True, exist_ok=True)
        page.parent.mkdir(parents=True, exist_ok=True)
        # Create the password file with restricted permissions from the outset.
        fd = os.open(auth, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
        with os.fdopen(fd, "w") as handle:
            handle.write("muwebtest:" + hashed + "\n")
        os.chown(auth, 0, gid)
        os.chmod(auth, 0o640)
        snippet.write_bytes((HERE / "nginx-lab.conf").read_bytes())
        source = (HERE.parent / "gcp" / "smoke.html").read_text(encoding="utf-8")
        if source.count("'/mu/connect'") != 1:
            raise RuntimeError("Unexpected smoke page WebSocket path")
        page.write_text(source.replace("'/mu/connect'", "'/network-lab/mu/connect'"), encoding="utf-8")
        os.chmod(snippet, 0o644)
        os.chmod(page.parent, 0o755)
        os.chmod(page, 0o644)

    def validate_reload():
        subprocess.run(["nginx", "-t"], check=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=True)

    backup = change_site(target, new_text, Path("/var/backups/muweb-lab"), validate_reload)
    print("Saved configuration backup:", backup)
    print("Lab routes disabled; lab files retained" if remove else
          "Open https://playonline.muorigins.online/network-lab/smoke.html (user: muwebtest)")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("STOP:", error, file=sys.stderr)
        print("If lab files were created, keep them for inspection; no automatic deletion is performed.", file=sys.stderr)
        sys.exit(1)
