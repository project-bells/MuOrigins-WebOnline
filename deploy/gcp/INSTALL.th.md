# ติดตั้ง MuOrigins-WebOnline บน Google Cloud แบบแยกจากเซิร์ฟเวอร์เดิม

คู่มือนี้ใช้ **Google Cloud project ใหม่ + VPC ใหม่ + VM ใหม่ + MySQL volume ใหม่ + hostname staging ใหม่** ห้ามรันคำสั่งติดตั้งบน VM เกมเดิม และห้ามนำ gateway ไปต่อ GameServer production ในระยะทดสอบ

สถานะ: gateway/JS adapter ผ่าน local tests แล้ว แต่แพตช์ browser C++ ยังไม่ได้ build/ทดสอบเข้าเกมจริง ตัวอย่าง Compose/Nginx/GCP ด้านล่างยังไม่ได้ deploy จริง การเปิด smoke.html สำเร็จพิสูจน์ WSS transport เท่านั้น

## 1. เตรียม project สำหรับ staging

สร้าง project ใหม่ผ่าน Google Cloud Console เปิด billing ของ project ใหม่นี้ แล้วเปิด Cloud Shell ผู้ทำต้องมีสิทธิ์สร้าง Compute Engine/VPC/firewall และใช้ IAP/SSH ใน project นี้ ดูสิทธิ์ที่ต้องใช้ใน [เอกสาร IAP](https://docs.cloud.google.com/iap/docs/using-tcp-forwarding)

ตั้ง budget alert ใน project ใหม่ ค่า VM, disk และ external IP มีค่าใช้จ่าย ไม่ใช่การติดตั้งฟรี เครื่อง e2-standard-2 ด้านล่างเป็นตัวอย่างขนาดสำหรับเริ่ม build/staging ไม่ใช่ผลวัด capacity ของเกม

คำสั่งส่วนนี้ใช้ Bash ใน Cloud Shell ให้แทนค่า project และ public IP ของเครื่องผู้ทดสอบเอง:

```bash
export LAB_PROJECT='YOUR_NEW_STAGING_PROJECT_ID'
export LAB_REGION='asia-southeast1'
export LAB_ZONE='asia-southeast1-a'
export LAB_VM='muweb-staging-01'
export LAB_ADMIN_CIDR='YOUR_PUBLIC_IPV4/32'
gcloud projects describe "$LAB_PROJECT" --format='value(projectId,name)'
```

ตรวจว่า project ที่แสดงเป็น project ใหม่สำหรับ staging จริงก่อนทำขั้นถัดไป ทุกคำสั่งกำหนด `--project` โดยตรง ไม่เปลี่ยน default project ที่อาจเป็น production

```bash
gcloud services enable compute.googleapis.com iap.googleapis.com --project="$LAB_PROJECT"
gcloud compute networks create muweb-staging-vpc --subnet-mode=custom --project="$LAB_PROJECT"
gcloud compute networks subnets create muweb-staging-subnet \
  --network=muweb-staging-vpc --region="$LAB_REGION" --range=10.77.0.0/24 \
  --project="$LAB_PROJECT"

gcloud compute firewall-rules create muweb-staging-iap-ssh \
  --network=muweb-staging-vpc --direction=INGRESS --action=ALLOW \
  --rules=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=muweb-staging \
  --project="$LAB_PROJECT"
gcloud compute firewall-rules create muweb-staging-http-acme \
  --network=muweb-staging-vpc --direction=INGRESS --action=ALLOW \
  --rules=tcp:80 --source-ranges=0.0.0.0/0 --target-tags=muweb-staging \
  --project="$LAB_PROJECT"
gcloud compute firewall-rules create muweb-staging-https-testers \
  --network=muweb-staging-vpc --direction=INGRESS --action=ALLOW \
  --rules=tcp:443 --source-ranges="$LAB_ADMIN_CIDR" --target-tags=muweb-staging \
  --project="$LAB_PROJECT"

# Prevent the VM from connecting to external MU/DB ports used by this example.
# Container-to-container traffic on this same host does not traverse the GCP NIC.
gcloud compute firewall-rules create muweb-staging-block-external-game-db \
  --network=muweb-staging-vpc --direction=EGRESS --action=DENY --priority=900 \
  --rules=tcp:3306,tcp:44405,tcp:55901,tcp:55980,tcp:55990,udp:55601 \
  --destination-ranges=0.0.0.0/0 --target-tags=muweb-staging \
  --project="$LAB_PROJECT"

gcloud compute addresses create muweb-staging-ip --region="$LAB_REGION" --project="$LAB_PROJECT"
export LAB_IP=$(gcloud compute addresses describe muweb-staging-ip \
  --region="$LAB_REGION" --project="$LAB_PROJECT" --format='value(address)')
gcloud compute instances create "$LAB_VM" --project="$LAB_PROJECT" \
  --zone="$LAB_ZONE" --machine-type=e2-standard-2 \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=50GB --boot-disk-type=pd-balanced \
  --subnet=muweb-staging-subnet --address="$LAB_IP" --tags=muweb-staging \
  --no-service-account --no-scopes --metadata=enable-oslogin=TRUE
printf 'Staging external IP: %s\n' "$LAB_IP"
```

ไม่สร้าง VPC peering/VPN/shared disk กับ production และไม่เปิด 3306/44405/55901 ต่อ Internet กฎ egress เป็นการป้องกันเพิ่มสำหรับ ports ที่ระบุ ไม่ใช่การรับประกันว่าจะบล็อกปลายทาง production ที่ใช้ ports อื่น การกำหนด fixed routes ใน gateway และแยก project เป็นหลักสำคัญ

ถ้า IAM องค์กรบล็อก OS Login/IAP ให้ผู้ดูแลมอบสิทธิ์ที่เหมาะสมใน project staging นี้ ไม่ควรแก้โดยเปิด SSH สู่ทุก IP หรือปรับ firewall production

เอกสารอ้างอิง: [สร้าง VM](https://docs.cloud.google.com/compute/docs/instances/create-start-instance), [gcloud instances create flags](https://docs.cloud.google.com/sdk/gcloud/reference/compute/instances/create), [VPC firewall](https://docs.cloud.google.com/firewall/docs/firewalls)

## 2. ชี้เฉพาะชื่อเว็บทดสอบและเข้า VM ใหม่

สร้าง A record `playonline-staging.muorigins.online` → LAB_IP เท่านั้น อย่าแก้ A/CNAME ของ `muorigins.online` หรือ `playonline.muorigins.online` ถ้ามี AAAA ของชื่อ staging ที่ชี้ผิดให้แก้เฉพาะ record นั้น

```bash
gcloud compute ssh "$LAB_VM" --project="$LAB_PROJECT" --zone="$LAB_ZONE" --tunnel-through-iap
```

คำสั่งถัดไปทั้งหมดรัน **ใน VM ใหม่** ตรวจชื่อก่อน:

```bash
hostname
```

ต้องเป็น `muweb-staging-01` หากไม่ตรงให้หยุด ไม่ติดตั้ง Docker/Nginx บน VM เกมเดิม

## 3. ติดตั้ง Docker และโหลด repository บน VM ใหม่

ติดตั้ง Docker Engine และ Compose plugin ตาม [คู่มือ Ubuntu อย่างเป็นทางการ](https://docs.docker.com/engine/install/ubuntu/) ตัวอย่างสำหรับ Ubuntu 24.04 ใหม่:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
printf '%s\n' \
  'Types: deb' \
  'URIs: https://download.docker.com/linux/ubuntu' \
  'Suites: noble' \
  'Components: stable' \
  "Architectures: $(dpkg --print-architecture)" \
  'Signed-By: /etc/apt/keyrings/docker.asc' \
  | sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker nginx
sudo install -d -o "$USER" -g "$(id -gn)" /srv/muweb
cd /srv/muweb
git clone https://github.com/project-bells/MuOrigins-WebOnline.git app
cd app
git log -1 --oneline
sudo docker compose version
```

ถ้างานอยู่ branch `staging/ws-gateway` ให้ clone ด้วย `--branch staging/ws-gateway` หรือ checkout branch หลัง clone ตาม link/commit ที่เผยแพร่จริง ถ้า repository เป็น private ให้ใช้ credential helper/deploy key แบบอ่านอย่างเดียว อย่าใส่ token ลง clone URL หรือไฟล์ repository

## 4. เปิด transport จำลองก่อน ไม่ต้องมี GameServer

```bash
cd /srv/muweb/app
cp deploy/gcp/.env.example deploy/gcp/.env
chmod 600 deploy/gcp/.env
```

เปิด `deploy/gcp/.env` ตั้ง `MU_ORIGIN=https://playonline-staging.muorigins.online` ให้ตรง host ที่ใช้จริง และเปลี่ยน passwords สองค่าเป็นค่าสุ่มใหม่ก่อนขั้น GameServer ห้ามใช้ password production

```bash
sudo docker compose --env-file deploy/gcp/.env -f deploy/gcp/compose.smoke.yml config --quiet
sudo docker compose --env-file deploy/gcp/.env -f deploy/gcp/compose.smoke.yml up -d --build
curl --fail http://127.0.0.1:18081/healthz
sudo install -d -m 0755 /srv/muweb/static
sudo install -m 0644 deploy/gcp/smoke.html /srv/muweb/static/smoke.html
```

คำตอบ healthz ต้องเป็น `ok` แต่หมายถึง gateway ทำงานเท่านั้น ไม่ใช่สถานะ GameServer

ติดตั้ง Nginx config เฉพาะ VM ใหม่:

```bash
sudo install -m 0644 deploy/gcp/nginx-http.conf /etc/nginx/sites-available/muweb-staging
sudo ln -s /etc/nginx/sites-available/muweb-staging /etc/nginx/sites-enabled/muweb-staging
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d playonline-staging.muorigins.online --redirect
sudo certbot renew --dry-run
```

ถ้าใช้ชื่ออื่นต้องแก้ server_name ก่อน certbot ในขั้นนี้ certbot จะถามอีเมลและข้อตกลง ใช้ certificate ของ staging host แยกจากเว็บจริง; port 80 เปิดเพื่อ ACME validation ส่วน 443 จำกัด IP ผู้ทดสอบตาม firewall

เปิด `https://playonline-staging.muorigins.online/smoke.html` จาก IP ที่อนุญาต กดทดสอบ ต้องเห็น ready และ bytes ของ fixture ไม่มีบัญชี/password/ตัวละคร และไม่ใช่เกมเข้าได้แล้ว

## 5. สร้าง GameServer และ DB ทดสอบแยก

ขั้นนี้ใช้เมื่อ transport ผ่านแล้ว เป็น backend ชุดใหม่ใน VM นี้ ไม่มีข้อมูลผู้เล่นจริง:

```bash
cd /srv/muweb/app
mkdir -p upstream
git clone https://github.com/EmanuelCatania/Mu-Linux-0.97k.git upstream/server
git -C upstream/server checkout --detach fdfa008b4beb2905b9b0e144a7d6bb7713627766
```

ตรวจ config ของ checkout staging เช่น `MuServer/GameServer/DATA/GameServerInfo - StartUp.dat`, `MuServer/ConnectServer/ConnectServer.ini` และ `MuServer/ConnectServer/ServerList.dat` ใช้ ServerCode ต่ำกว่า 256 ชื่อ SV staging และ CustomerName/Serial/Version ที่จะใช้ build browser ตรงกัน

Compose game กำหนด PUBLIC_IP=127.0.0.1 เพื่อเป็น logical redirect mapping; upstream entrypoint เปลี่ยน advertised IP ใน ServerList.dat ให้ค่านี้ ไม่เกี่ยวกับ IP production

ตั้ง MaxIpConnection ของ CS/GS ให้รองรับจำนวนผู้ทดสอบที่ผ่าน gateway IP เดียวกัน ห้ามตั้ง 0 เพราะ implementation นี้ปฏิเสธ IP ใหม่ ค่า default ของ CS ที่ตรวจคือ 10 อย่าแก้ anti-cheat/serial checks เพื่อให้ login ผ่าน

MySQL schema upstream ระบุ `USE MuOnline97` คู่มือจึงใช้ชื่อนี้ใน **container/volume ใหม่** ไม่ได้ต่อฐานข้อมูล production แม้ชื่อ DB จะเหมือนกัน service ไม่มี published MySQL port และ DB_HOST=mysql ถูกกำหนดใน Compose โดยตรง MySQL 5.7 ใช้เพื่อเข้ากับ upstream ใน lab เท่านั้น ต้องประเมินการอัปเกรดและ image/dependency security ก่อน production

```bash
sudo docker compose --env-file deploy/gcp/.env -f deploy/gcp/compose.smoke.yml down
sudo docker compose --env-file deploy/gcp/.env -f deploy/gcp/compose.game.yml config --quiet
sudo docker compose --env-file deploy/gcp/.env -f deploy/gcp/compose.game.yml up -d --build
sudo docker compose --env-file deploy/gcp/.env -f deploy/gcp/compose.game.yml ps
sudo docker compose --env-file deploy/gcp/.env -f deploy/gcp/compose.game.yml logs --tail=100 mu-staging
```

ใช้ project Compose `mu-web-staging` ของ VM ใหม่นี้เท่านั้น **ไม่ใช้ `down -v`** เพราะจะลบ DB ทดสอบที่สร้างใหม่ อย่านำขั้นตอนนี้ไปรันบน VM เดิม

สร้างบัญชีทดสอบผ่านขั้นตอนของ server fork ที่เลือก โดยตรวจ `JoinServer.ini` ว่า MD5Encryption mode ตรงกับวิธีสร้าง password ไม่ใช้ SQL plaintext insert แบบเดาสุ่ม ห้ามนำ account dump/รหัสผู้เล่นจริงมาทดสอบ ที่นี่ไม่ได้ seed บัญชีสาธารณะและไม่ได้เปิด admin web ของ upstream

ถ้า build daemon ไม่ผ่านให้หยุดแก้ใน checkout staging พร้อมเก็บ log ไม่มีเหตุผลต้องแก้ package/runtime ของ VM เกมจริง

## 6. Build browser และติดตั้งหน้าเล่น

ทำบนเครื่อง build แยกที่มี Emscripten โดย checkout browser commit `fb5d6aed769e6384a2f25164e75eded456307be7` แล้ว apply `browser-online.patch` ตาม README หลัก ตั้ง ServerConfig ให้ตรง staging และ rebuild ทุกไฟล์ที่เปลี่ยนก่อน link ไม่ใช้ WASM solo ที่มากับ upstream แทน

วาง rebuilt JS/WASM/data พร้อม `remote.html`, `remote-fs.js`, `browser-adapter.mjs` ไว้ `/srv/muweb/static/` ให้ทุก artifact มาจาก build เดียวกัน ค่า default mapping ใน remote.html เป็น `127.0.0.1:44405` และ `127.0.0.1:55901` ตรงตัวอย่าง Compose นี้

เปิด `https://playonline-staging.muorigins.online/remote.html` ตรวจ Network/Console: CS list → redirect → GS greeting → HWID → manual login → character list ไม่มี production account ในการทดสอบ ตรวจ `.wasm` MIME ด้วย `curl -I` และแก้ mime.types ของ staging Nginx หากไม่ใช่ application/wasm

**ขณะส่งมอบนี้ยังไม่มี rebuilt WASM ที่ผ่านการยืนยัน** จึงจบขั้น smoke ได้ก่อน แล้วทำขั้น build/native compatibility ต่อแยกตาม REPORT.th.md

## 7. ทดสอบ Windows client กับ staging โดยไม่เปิด MU ports สาธารณะ

จากเครื่อง Windows ที่มี Google Cloud CLI/OpenSSH เปิด tunnel ค้างไว้ (แทนค่า project/zone):

```bash
gcloud compute ssh muweb-staging-01 --project=YOUR_NEW_STAGING_PROJECT_ID \
  --zone=asia-southeast1-a --tunnel-through-iap -- \
  -N -L 44405:127.0.0.1:44405 -L 55901:127.0.0.1:55901
```

ใช้ Windows client **สำเนาทดสอบ** ตั้ง identity/version/serial ให้ตรง staging และ connect ไป localhost:44405 อย่าแก้ไฟล์ Windows client ที่ผู้เล่น production ใช้ ถ้า local ports ถูกใช้อยู่ต้องใช้เครื่องทดสอบอื่นหรือวางแผนแก้ redirect และ mapping ให้สอดคล้องกันก่อน

ใช้บัญชี browser และ Windows คนละบัญชี ตรวจเห็นกัน/move/chat/combat/party/trade/inventory/teleport/logout/relog แล้วตรวจ DB persistence ทดสอบบัญชีเดียวกันเพื่อพิสูจน์ duplicate-login behavior เพิ่มเติม

## 8. Update / rollback เฉพาะ staging

จด commit/image ก่อนอัปเดตและสำรอง DB ทดสอบของ environment นี้เอง การเปลี่ยน gateway ต้อง disconnect WebSocket ที่เปิดอยู่; ไม่ใช่ seamless reconnect

```bash
cd /srv/muweb/app
git pull --ff-only
sudo docker compose --env-file deploy/gcp/.env -f deploy/gcp/compose.game.yml up -d --build --no-deps gateway
```

ถ้าต้องหยุดทดสอบ:

```bash
sudo docker compose --env-file deploy/gcp/.env -f deploy/gcp/compose.game.yml stop gateway
```

คำสั่งนี้กระทบเฉพาะ browser staging gateway ใน VM ใหม่นี้ Windows production ไม่ได้ใช้มัน ถ้ารัน smoke profile ให้ใช้ compose.smoke.yml แทน สำหรับ rollback deployment ให้ checkout release/commit ที่จดไว้ใน staging checkout หลังตรวจ working tree แล้ว rebuild เฉพาะ gateway; เก็บ DB volume ไว้

ขั้นสุดท้ายจึงค่อยออกแบบการชี้ `playonline.muorigins.online` และเชื่อม backend จริงหลังผ่าน acceptance ทุกข้อ การเชื่อม backend จริงย่อมเพิ่ม load และเปลี่ยนข้อมูลผู้เล่น จึงไม่อ้างว่า “ไม่กระทบ production” ในระยะนั้น คู่มือนี้ไม่ทำขั้นดังกล่าว

เมื่อพัก lab ให้หยุด VM ผ่าน Console ของ project staging เพื่อลด compute cost โดย disk/static IP อาจยังคิดค่าใช้จ่ายอยู่ ไม่ลบ resource หรือ DB อัตโนมัติ

## รายการตรวจจบงาน

- Project/VM/VPC/DNS ของ production ไม่ได้เปลี่ยน
- ไม่มี MU/database ports เปิด Internet; HTTPS เปิดเฉพาะ IP ผู้ทดสอบ
- smoke fixture ผ่าน ก่อนต่อ staging daemons
- DB เป็น volume ใหม่และใช้บัญชีทดสอบใหม่
- Browser native build/login และ Windows coexistence ต้องผ่านก่อนเรียกว่าพร้อมเล่น
- Docker/Nginx/GCP commands ในคู่มือนี้ต้องตรวจ runtime บน VM ใหม่; ยังไม่ได้ execute ใน Google Cloud จากแชตนี้

เอกสารตรวจสอบเพิ่มเติม: [gcloud SSH/forwarding](https://docs.cloud.google.com/sdk/gcloud/reference/compute/ssh), [Certbot Nginx](https://certbot.eff.org/instructions?ws=nginx&os=snap)
