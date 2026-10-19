# เพิ่มหน้าทดสอบบน VM เดิมที่ตรวจแล้ว

ใช้เฉพาะ `instance-20261017-074800` ที่มี Nginx config/root ตรงกับข้อมูลที่ผู้ใช้ส่งมา Script จะหยุดเมื่อไม่ตรงเงื่อนไข ใช้ mock backend ที่ผ่าน local transport test แล้ว ไม่เชื่อม production GameServer หรือฐานข้อมูล

จาก `~/muorigins-webonline-lab`:

```bash
git pull --ff-only origin main
sudo env MU_ORIGIN=https://playonline.muorigins.online \
  docker compose -p muweb-lab \
  -f deploy/gcp/compose.smoke.yml \
  -f work/compose.limits.yml \
  up -d --no-deps gateway
curl --fail --retry 5 --retry-delay 2 --retry-all-errors http://127.0.0.1:18081/healthz
sudo python3 deploy/same-vm/install.py
```

ขั้นแรกเปลี่ยน Origin และสร้างใหม่เฉพาะ lab gateway; เปิด WS เดิมของ lab จะถูกตัด ไม่สั่ง build/restart MU containers เดิม ตัวจำกัด CPU/RAM ใน work/compose.limits.yml ต้องยังอยู่ตามขั้นก่อนหน้า

Installer ขอรหัสผ่านใหม่อย่างน้อย 12 ตัวอักษรสองครั้ง สำหรับ username `muwebtest` อย่าใช้รหัสบัญชี MU หรือส่ง password กลับมาในแชต มันสร้าง htpasswd hash โดยไม่ใส่รหัสใน command arguments

เพิ่มเฉพาะ exact locations `/network-lab/smoke.html` และ `/network-lab/mu/connect` พร้อม HTTP Basic Authentication ใน HTTPS server เดิม ใช้ certificate เดิม ไม่มีการเปลี่ยน root/index/location / หรือไฟล์ Solo game

ไฟล์ใหม่: `/etc/nginx/snippets/muweb-lab.conf`, `/etc/nginx/muweb-lab.htpasswd`, `/srv/muweb-lab/smoke.html` และ backup config ใน `/var/backups/muweb-lab/` ไม่วาง backup ใน sites-enabled ที่อาจถูก Nginx โหลดซ้ำ

ก่อนแก้ตรวจ nginx -t และ health gateway; หลังแก้ตรวจ nginx -t อีกครั้งแล้ว reload (ไม่ restart) หาก validation/reload command ล้มเหลว จะคืน bytes ของ config เดิมและคงไฟล์ lab ไว้ตรวจสอบ กรณีเกิดข้อผิดพลาดระหว่างเตรียมไฟล์อาจมีไฟล์ lab ที่ยังไม่ได้ใช้งานค้างอยู่ Script จะปฏิเสธการเขียนทับเพื่อให้ตรวจสาเหตุก่อน ไม่รับประกันว่าการเปลี่ยน Nginx บนเครื่องร่วมไม่มีความเสี่ยงเลย

เปิด https://playonline.muorigins.online/network-lab/smoke.html ใส่ username/password แล้วกดทดสอบ ควรเห็น ready และ bytes fixture ยังไม่ใช่หน้าเล่นเกมออนไลน์ ตรวจว่า https://playonline.muorigins.online/ ยังแสดงหน้า Solo เดิม

หาก browser ไม่ส่ง HTTP Basic credentials ให้ WebSocket handshake หรือมี Cloudflare/WAF policy ขวาง อาจพบ 401/403 แม้เปิดหน้า HTML ได้ ให้ส่ง status/error ที่ไม่มี Authorization header มาตรวจ ไม่ถอดรหัสผ่านหรือข้าม authentication เพื่อให้ผ่าน

ปิด routes ทดสอบโดยเอา include ของ lab ออก แล้วตรวจและ reload โดย script เดิม:

```bash
sudo python3 deploy/same-vm/install.py --remove
```

ไฟล์ lab/password/backup จะเก็บไว้ ไม่ลบข้อมูลโดยอัตโนมัติ ก่อนเปิดใหม่หลัง remove ต้องตรวจไฟล์ค้างด้วยตนเอง; installer ไม่เขียนทับไฟล์เหล่านั้น

การตรวจในเครื่องพัฒนา: Python unit tests ตรวจ guard, preserved routes, backup/rollback ผ่าน แต่ไม่มี Nginx/Linux production instance ในเครื่องพัฒนา การยืนยัน nginx -t และ browser WSS จริงเกิดบน VM เมื่อผู้ใช้รันขั้นตอนนี้

อ้างอิง [HTTP Basic Authentication](https://nginx.org/en/docs/http/ngx_http_auth_basic_module.html), [WebSocket proxy headers](https://nginx.org/en/docs/http/websocket.html), [Nginx reload](https://nginx.org/en/docs/control.html)
