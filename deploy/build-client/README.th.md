# Compile checkpoint บน WebOnline VM ใหม่

อัปเดตจากผล VM: compile ครบ 332 objects แล้ว โดย container จบ exited/exit=0/oom=false ขั้นต่อไปใช้ link checkpoint ด้านล่าง ไม่ต้อง compile ใหม่หาก source/compiler ไม่เปลี่ยน

ABI/protocol-header probes ผ่านบน VM `instance-20261019-125137` โดยใช้ emscripten/emsdk:6.0.12 (digest ที่ผู้ใช้ pull: sha256:77638e6c215a65f25a704c0c831d5c2463a8c0468a58c6cb82489dbe621dfa05)

ขั้นต่อไป compile ทุก translation unit ใน m2-sources.txt ของ browser base fb5d6ae พร้อม shell_login/net_ws/mu_mesh_draw และ native protocol static assertions ไม่ link หรือเผยแพร่เว็บในขั้นนี้

```bash
cd ~/muorigins-webonline-lab
git pull --ff-only origin main
bash deploy/build-client/start.sh
sudo docker logs -f muweb-client-build
```

Launcher ตรวจ hostname/commit, เช็ก patch ก่อน apply และจำกัด container ที่ CPU 1 core / RAM 2 GiB / ไม่เพิ่ม swap / 256 pids / ไม่มี network ไม่มี Docker socket mount และเห็น source แบบ read-only เฉพาะการ apply patch บน host ที่แก้ checkout ทดลองของ client ไม่เห็นโฟลเดอร์เว็บที่ Nginx ใช้หรือ daemon/database ของเกม

ตรวจแรมว่าง 2.5 GiB และ disk 8 GiB ก่อนเริ่มเป็น guard ของการทดลอง ไม่ใช่การรับรองว่า compiler/linker ใช้ไม่เกินขอบเขตนั้น OOM อาจเกิดได้และต้องดู exit status ไม่ปิด OOM safeguards

ใช้ OpenGL include shims สำหรับชื่อ gl/GL.h, gl/gl.h, gl/GLU.h, gl/glu.h ที่ต่างตัวพิมพ์บน Linux Compile ทีละไฟล์ เก็บ log และหยุดที่ failure แรก ไม่ใช้ compile-objects.bat ที่นับ failure แล้วคืน exit 0

สำเร็จต้องเห็น CLIENT_COMPILE_PASS แต่ยังไม่มี rebuilt browser JS/WASM/data ที่พร้อมเล่น Link, upstream generated-JS rendering fixes, staging identity/login และ browser runtime checks ยังต้องทำต่อหลังผ่าน checkpoint นี้ โดย PowerShell rendering patch ของ upstream ยังไม่ได้ port มารันบน Linux

ถ้า SSH หลุด container ยังทำงาน ดู logs ต่อได้ Ctrl+C ตอนดู docker logs หยุดแค่การติดตาม log ไม่หยุด build

```bash
sudo docker inspect --format 'status={{.State.Status}} oom={{.State.OOMKilled}} exit={{.State.ExitCode}}' muweb-client-build
sudo docker stats --no-stream muweb-client-build
```

หยุดเฉพาะ build: `sudo docker stop muweb-client-build` ไม่ stop gateway/MU containers

ก่อน retry ตรวจว่า container จบแล้ว จากนั้นใช้ `sudo docker rm muweb-client-build` แล้วรัน start.sh อีกครั้ง (อย่าใช้ -f กับ container ที่ยังทำงาน) Object ที่สำเร็จใช้ต่อได้เฉพาะ fingerprint ของ compiler/script/flags/source/headers ตรงกันทั้งหมด หาก source/header เปลี่ยนจะ compile ใหม่ ไม่ใช้ stale object

ผลทั้งหมดอยู่ใน ignored `work/client-build/` โดย source ดั้งเดิมอยู่ `upstream/browser/` และถูกแก้เฉพาะ candidate patch ไม่ copy ทับ /srv/muweb/static และไม่เปลี่ยน Nginx

## Link checkpoint หลัง compile ผ่าน

```bash
cd ~/muorigins-webonline-lab
git pull --ff-only origin main
bash deploy/build-client/start-link.sh
sudo docker logs -f muweb-client-link
```

Linker ตรวจ compile container และเทียบ fingerprint ของ compiler/source/headers/compile.py กับ state เดิมก่อนใช้ objects ไม่แก้ compile.py ในการเพิ่มขั้น link นี้ จึงไม่ทำให้ 332 objects ที่เพิ่ง build เสร็จหมดอายุโดยไม่มีเหตุผล

แก้ปัญหา undefined mu_gdi_current_font / mu_font_query: browser/mu_gdi.cpp มี implementation จริง แต่ไม่มีอยู่ใน m2-sources.txt ของ upstream ส่วน Windows batch เดิม link ทุก object ที่ค้างอยู่ใน out/all จึงอาจพึ่งไฟล์นี้โดยไม่ได้ระบุใน manifest ใหม่ Link checkpoint จะ compile mu_gdi.cpp เพิ่มหนึ่งไฟล์ก่อน link รวม 333 objects โดยไม่ invalidate/recompile 332 objects เดิม และไม่ใช้ dummy stubs หรือปิด undefined-symbol errors

หาก link ครั้งก่อนจบ failure แล้ว ให้เก็บ logs และลบเฉพาะ container link ที่จบแล้วก่อน retry:

```bash
sudo docker inspect --format 'status={{.State.Status}} oom={{.State.OOMKilled}} exit={{.State.ExitCode}}' muweb-client-link
sudo docker rm muweb-client-link
bash deploy/build-client/start-link.sh
sudo docker logs -f muweb-client-link
```

docker rm ไม่ลบ bind-mounted objects/logs ใน work/client-build และไม่ได้ลบ compile container หรือ lab gateway; ถ้ายัง running จะไม่ลบเพราะไม่ได้ใช้ -f

จำกัด CPU 1 core / RAM 2560 MiB / memory-swap เท่ากับ RAM / 256 pids และไม่มี network ต้องมี MemAvailable อย่างน้อย 3 GiB และ disk ว่าง 5 GiB ก่อนเริ่ม ถ้าเกิน memory cap งานอาจจบ OOM ให้ตรวจสถานะ ไม่เพิ่มขีดจำกัดโดยอัตโนมัติ

ผลอยู่ใน directory ใหม่ใต้ `work/client-build/releases/` ทุกครั้ง ไม่มีการ copy เว็บ/เปลี่ยน Nginx หรือชี้ gateway ไป GameServer จริง ไฟล์หลักคือ shell_login.js, shell_login.wasm และ shell_login.data โดยใช้ link options และ preloaded assets ตาม upstream batch script

หลัง link จะอ่าน Replace-Once/Replace-Count จาก patch-login-page.ps1 ของ source ที่ตรึงไว้ โดยเป็นตัวอ่าน literal ที่จำกัดรูปแบบ ไม่ใช่ PowerShell evaluator ต้องพบจำนวน matches ตรงทุกกฎ มิฉะนั้นหยุดโดยไม่ประกาศ release สำเร็จ แก้ renderer รวม 17 กฎและลบ include comments ตามขั้น upstream จากนั้นตรวจ JS syntax, ชื่อ network exports และ hashes ของ artifacts

ตรวจ port renderer ในเครื่องพัฒนาแล้ว: อ่าน 17 กฎได้และ reverse/apply round trip กับ web/shell_login.js ของ upstream กลับมาเหมือนเดิมทั้งหมด นี่พิสูจน์ความตรงของ literal transformations กับ artifact อ้างอิง ไม่ใช่การรัน renderer ใหม่ใน browser Native link บน Linux VM ยังต้องยืนยันด้วยผลของขั้นนี้

สำเร็จต้องเห็น CLIENT_LINK_PASS และมี release.json/ล่าสุดใน latest-linked-release.txt ชื่อ exported functions ใน JS เป็นการตรวจขั้นต้นเท่านั้น Browser rendering, runtime exports จริง, login และ Windows coexistence ยังต้องพิสูจน์

```bash
sudo docker inspect --format 'status={{.State.Status}} oom={{.State.OOMKilled}} exit={{.State.ExitCode}}' muweb-client-link
cat work/client-build/latest-linked-release.txt
```

หาก failure ส่งข้อความช่วงท้ายและ container status กลับมา Log เต็มอยู่ใน release directory ที่แสดง Linker เก็บ unpatched JS ถ้า renderer stage เริ่มทำแล้ว และจะไม่แก้ latest-linked-release.txt เมื่อขั้นตอนนั้นล้มเหลว ก่อน retry ตรวจ container จบแล้วจึง `sudo docker rm muweb-client-link` โดยไม่ใช้ -f กับงานที่ยังทำอยู่
