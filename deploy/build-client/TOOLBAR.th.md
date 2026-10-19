แถบ MU ORIGINS / WEB ONLINE

ใช้ installer กับโฟลเดอร์เว็บที่ทำงานแล้ว เพื่อรักษา endpoint mapping และ
JS/WASM/data ของ build เดียวกัน โปรแกรมปฏิเสธการเขียนทับ target ที่มีอยู่

```bash
cd ~/muorigins-webonline-lab
git pull --ff-only origin main
sudo python3 deploy/build-client/install-toolbar.py \
  /srv/muweb/static/production-thai-auto-v1 \
  /srv/muweb/static/webonline-toolbar-v1
```

เปิด /webonline-toolbar-v1/remote.html ไม่ต้อง rebuild หรือ restart server
ย้อนกลับด้วยการเปิด URL เดิม ไม่มีการแก้ gateway, DNS หรือข้อมูลผู้เล่น

Auto เรียก native _mu_auto_attack ของ build เดิม ปุ่มจะพร้อมเมื่อ runtime
เริ่มแล้ว หยุดเมื่อเปิดวิธีใช้ เข้าเต็มจอ เสีย focus เปลี่ยนแท็บ หรือกด Esc
ONLINE CLIENT ระบุชนิดหน้า ไม่ใช่ตัวชี้วัดว่าเชื่อมเกมสำเร็จ

ไม่มี Save/Import/Export, ตัวคูณ EXP ที่เดาเอง หรือ solo worker
ตัวละครและไอเทมบันทึกโดยเซิร์ฟเวอร์เกมตามปกติ

ตรวจแล้ว: JS tests, installer แยก directory และคง routes เดิม,
หน้า preview ด้วย runtime จำลอง: Auto/Stop, เปิดปิดวิธีใช้, เต็มจอ
ต้องทดสอบร่วมกับ WASM จริงหลังติดตั้งบน VM และบนมือถือเพิ่มเติม
