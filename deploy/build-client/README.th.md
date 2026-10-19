# Compile checkpoint บน WebOnline VM ใหม่

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
