"""Create a separate toolbar page from a deployed, working online client."""
from pathlib import Path
import re
import shutil
import sys

source, target = [Path(arg).resolve() for arg in sys.argv[1:]]
repo = Path(__file__).resolve().parents[2]
assert source.is_dir() and not target.exists(), 'Source missing or target already exists'
for name in ('shell_login.js', 'shell_login.wasm', 'shell_login.data', 'remote-fs.js', 'browser-adapter.mjs'):
    assert (source / name).is_file(), 'Missing client file: ' + name
text = (source / 'remote.html').read_text(encoding='utf-8')
assert text.count('<canvas id="canvas"') == 1
marker = '<script src="remote-fs.js"></script>'
assert text.count(marker) == 1 and 'window.muRemote=createAdapter' in text
header = '''<header id="muTopBar" class="mu-bar">
<div class="mu-brand"><strong>MU ORIGINS</strong><small>/ WEB ONLINE 0.97K</small><span class="mu-badge">● ONLINE CLIENT</span></div>
<nav class="mu-actions" aria-label="เครื่องมือเกม">
<button id="mu-auto-toggle" type="button" aria-pressed="false" disabled>▶ Auto</button>
<button id="mu-help-open" type="button">ⓘ วิธีใช้</button>
<button id="mu-fullscreen" type="button" aria-label="เต็มจอ" title="เต็มจอ">⛶</button>
</nav></header><main id="game-stage">'''
help_text = '''<dialog id="mu-help" aria-labelledby="mu-help-title">
<h2 id="mu-help-title">เล่น MU Origins บนเว็บ</h2>
<p>เดินด้วยคลิกซ้าย • โจมตีหรือใช้สกิลด้วยคลิกขวา<br>กด Enter เพื่อพิมพ์แชต</p>
<p>Auto: เข้าเกม เลือกสกิลคลิกขวาที่เรียนแล้ว จากนั้นกด ▶ Auto เพื่อโจมตีกลางจอ กด ■ Stop หรือ Esc เพื่อหยุด</p>
<p>เปลี่ยนแท็บหรือออกจากหน้าต่างจะหยุด Auto ระบบนี้ไม่เดินหาเป้าหมาย เก็บของ หรือเติมยาเอง</p>
<p>ตัวละครและไอเทมบันทึกที่เซิร์ฟเวอร์</p>
<button id="mu-help-close" type="button">กลับเข้าเกม</button></dialog>'''
text = re.sub(r'<style>.*?</style>', '<link rel="stylesheet" href="webonline-toolbar.css">', text, flags=re.S)
text = re.sub(r'<p>.*?</p>', '', text, flags=re.S)
text = text.replace('lang="en"', 'lang="th"')
text = re.sub(r'<title>.*?</title>', '<title>MU Origins · Web Online</title>', text)
text = text.replace('<canvas id="canvas"', header + '<canvas id="canvas"', 1)
text = text.replace('</canvas>', '</canvas><button id="mu-fullscreen-exit" type="button">ออกจากเต็มจอ</button></main>', 1)
text = text.replace('<pre id="status">', '<footer class="mu-status"><span id="auto-status" role="status"></span><pre id="status">', 1)
text = text.replace('</pre>', '</pre></footer>' + help_text, 1)
text = re.sub(r'<script src="browser-auto-attack.js"></script>\s*', '', text)
text = text.replace(marker, marker + '\n<script src="browser-auto-attack.js"></script>\n<script src="webonline-toolbar.js"></script>')
shutil.copytree(source, target)
for name in ('browser-auto-attack.js', 'webonline-toolbar.js', 'webonline-toolbar.css'):
    shutil.copyfile(repo / name, target / name)
(target / 'remote.html').write_text(text, encoding='utf-8')
print('TOOLBAR_DEPLOY_PASS:', target / 'remote.html')
