# Warroom — สถานะบอท

เว็บไซต์แยกจากเครื่องบอท เพื่อดูสถานะล่าสุดแม้ Mac ปิดหรือหลับ แสดงผู้ให้บริการและโมเดล AI แยกตามงาน โดยไม่ส่งเนื้อหาแชท ชื่อกลุ่ม ข้อมูลลูกค้า หรือ WhatsApp ID ขึ้นเว็บ

## สถานะการเปิดใช้

16 พฤศจิกายน 2026: สร้าง Worker, Static Assets, ฐานข้อมูล D1 และตัวตรวจทุกนาทีแล้ว ตั้ง Google Client ID บนเว็บออนไลน์แล้ว และผู้ดูแลเข้าสู่ระบบจริงได้แล้ว ข้อมูลบัญชี/อีเมล/กุญแจเชื่อมต่ออยู่ใน `.deployment.local.json` ที่ไม่เข้า Git หรือ index

เปิด telemetry และรีสตาร์ตบอทแล้ว ได้รับ heartbeat สองรอบและ WhatsApp รายงานเชื่อมต่อ ผู้ใช้ยืนยันอีเมลทดสอบเข้ากล่องแล้ว ผู้ใช้เลือกเมลผู้ดูแลเป็นผู้รับชั่วคราวและยืนยันแล้ว ตั้งโดเมนย่อยและ binding แล้ว แต่ ผู้ใช้ยืนยันว่าได้รับอีเมลทดสอบแล้ว และทดสอบ Worker ส่งอีเมลตามรอบตรวจโดยบริการรับคำขอสำเร็จ ไม่ได้เปลี่ยน DNS หรือสมัครบริการเสียเงิน

## ลองในเครื่อง

```bash
npm run warroom:dev
npm run warroom:test
npm run warroom:build
```

เปิด `http://127.0.0.1:4173` ใช้ข้อมูลและบัญชีจำลองเท่านั้น ตัวเลือกทดสอบอยู่ที่ `/__demo?state=offline&role=team` โดย state เลือก healthy/problem/offline/empty และ role เลือก admin/team ได้ ใช้ `login=1` เพื่อดูหน้าเตรียมเข้าสู่ระบบ ไม่มีเส้นทางนี้บนเว็บจริง

## สิ่งที่เว็บบอกได้

- เครื่องบอทส่งสถานะทุก 30 วินาที เกิน 2 นาทีขึ้นข้อมูลเก่า เกิน 5 นาทีจึงเข้าเกณฑ์อีเมลครั้งแรก
- การเชื่อม WhatsApp แยกจากส่งสำเร็จและหลักฐานการส่งถึง ไม่มีข้อความใหม่ไม่ได้แปลว่าบอทเสีย
- คิวหลัก อ่านไฟล์ และเรนเดอร์แสดงจำนวนงาน/อายุงาน ไม่มีปุ่มรีสตาร์ต
- AI แยกตอบคำขอ จับงานอัตโนมัติ สรุป อ่านภาพ/PDF และสร้างภาพ แยกโมเดลที่ขอใช้จากโมเดลในผลตอบกลับ
- ทีมดูภาพรวม กราฟเหตุการณ์รายชั่วโมง คิว/อายุงานค้าง และไทม์ไลน์สถานะ; ผู้ดูแลดูความเร็วและข้อผิดพลาดรายความสามารถ ประวัติย้อนหลัง 30 วัน จัดการสมาชิก และพักอีเมล 30 นาที/1 ชั่วโมง/4 ชั่วโมง พร้อมปุ่มสลับโทนสีสว่าง/มืด
- AI ล้มเหลว 3 ครั้งติดกันภายใน 10 นาทีในความสามารถเดียวกันจึงแจ้ง สิทธิ์/API key/โมเดลไม่มีให้แจ้งทันที ความเงียบไม่ใช่หลักฐานว่าฟื้นตัว
- แจ้งซ้ำทุก 1 ชั่วโมง ฟื้นตัวแจ้งหนึ่งครั้ง หลังหมดเวลาพักหรือกดยกเลิก ถ้าปัญหายังอยู่ให้แจ้งในรอบตรวจถัดไป (ปกติภายใน 1 นาที)
- เก็บประวัติเหตุการณ์ 30 วัน ล้างเป็นชุดทุกนาทีเพื่อจำกัดภาระ ไม่ได้เก็บเนื้อหาแชทหรือทุก heartbeat ย้อนหลัง

## Google login

1. สร้าง OAuth Client แบบ **Web application** ใน Google Cloud/Google Auth Platform ของทีม ตั้งชื่อแอปและข้อมูลติดต่อ
2. เพิ่ม URL หลักของ Warroom ใน **Authorized JavaScript origins** ไม่มี path ท้าย URL หน้าเว็บใช้ Google Identity Services popup/callback ไม่ใช้ OAuth redirect ของแอปเอง
3. ถ้าแอปอยู่ใน Testing ให้เพิ่มบัญชีผู้ดูแลเป็น test user ตามที่ Google กำหนด
4. ใส่ Client ID ใน `googleClientId` ของ `.deployment.local.json` แล้ว build/deploy อีกครั้ง ไม่ต้องใช้ Client Secret ใน frontend
5. เข้าด้วย Google ของผู้ดูแลคนแรกตาม `adminEmail` ระบบสร้างสิทธิ์หลังตรวจลายเซ็น Google สำเร็จเท่านั้น จากนั้นเพิ่มสมาชิกบนเว็บ

รองรับ Gmail และบัญชี Google Workspace ที่ Google ยืนยันโดเมนได้ บัญชี Google ที่ใช้อีเมลภายนอกซึ่ง Google ไม่ได้ยืนยันความเป็นเจ้าของเมลจะยังเข้าไม่ได้ แม้อยู่ในรายชื่ออนุญาต

ตรวจลายเซ็น/issuer/audience/nonce/อายุ token ฝั่งเซิร์ฟเวอร์ ใช้ session cookie Secure/HttpOnly และตรวจ role ใหม่ทุก API มี CSRF และป้องกันถอดผู้ดูแลคนสุดท้าย ไม่มีทางลัดเข้าสู่ระบบบน production

## Deploy

`deploy.mjs` ใช้ Cloudflare REST Direct Uploads และจัดการเฉพาะ Worker/ฐานข้อมูลชื่อ `whatsapp-warroom` ไม่แตะ DNS หรือ Worker อื่น ต้องมี Node 22.5+ สำหรับแอปและ Node ที่รองรับ fetch/FormData

สร้าง `warroom/.deployment.local.json` แบบ private (permission 0600):

```json
{
  "accountId": "ACCOUNT_ID",
  "adminEmail": "admin@example.com",
  "googleClientId": "GOOGLE_WEB_CLIENT_ID"
}
```

```bash
npm run warroom:build
node warroom/deploy.mjs
node warroom/deploy.mjs --apply
```

ตั้ง `CLOUDFLARE_API_TOKEN` ใน environment อย่างปลอดภัย หรือใช้ `--wrangler-auth` เพื่อใช้บัญชีที่เคย login ผ่าน Wrangler บนเครื่องนี้ สคริปต์จับ credential ไว้ในหน่วยความจำ ไม่พิมพ์หรือบันทึก token ของ Cloudflare ไม่สร้าง Wrangler config ในโปรเจกต์

คำสั่งที่ไม่มี `--apply` แสดงแผนเท่านั้น ค่าเริ่มต้น `alertsEnabled=false` และไม่มี email binding หากยังไม่มีผู้ส่ง/ผู้รับ เมื่อยืนยันกับบริการแล้วจึงเพิ่ม `alertTo`, `alertFrom` และ `alertsEnabled: true` ใน local config ค่าการแจ้งเตือนจึงคงอยู่ในการ deploy ครั้งถัดไป

ข้อมูล DB/URL/ingest token จะถูกบันทึกเฉพาะ `.deployment.local.json` การ deploy ซ้ำไม่ล้างข้อมูล

## เชื่อมบอทจริงเมื่อ login พร้อม

ตั้ง `WARROOM_URL` และ `WARROOM_INGEST_TOKEN` ใน `.env` ฝั่งบอท โดยใช้ token เดียวกับค่าที่ deploy ไว้ อย่าใส่ใน command line, screenshot หรือเอกสาร จากนั้นรีสตาร์ต launchd หนึ่ง instance ตามขั้นตอนเดิม ตรวจว่า heartbeat จริงเข้ามา 2 รอบและ WhatsApp เชื่อมต่อ โดยไม่ต้องส่งข้อความทดสอบอัตโนมัติ

การส่งสถานะแยกจากคิวแชท timeout 5 วินาที ความล้มเหลวของเว็บไม่บล็อกการตอบ เก็บ events รอส่งสูงสุด 500 รายการใน `data/warroom-telemetry.json` แบบ permission 0600 และส่งครั้งละ 200 ถ้าขาดการติดต่อยาวอาจมีประวัติหลุดจากคิว; snapshot มีจำนวน droppedEvents ไม่รับประกันกู้คืนทุกเหตุการณ์

## เปิดอีเมล

ต้องยืนยันอีเมลผู้รับและโดเมนผู้ส่งใน Cloudflare ก่อน ตั้ง `EMAIL` send_email binding จำกัดผู้รับ ตั้ง `ALERT_TO`, `ALERT_FROM`, `PUBLIC_URL` แล้วเปิด `ALERTS_ENABLED=true` การตั้งโดเมนอาจกระทบ DNS/MX ต้องตรวจของเดิมและขอบเขตที่ผู้ใช้ยืนยันก่อน ไม่ได้ตั้งไว้ในการ deploy ครั้งนี้

ระบบมี outbox/retry/lease กันรอบตรวจซ้อน และแสดงจำนวนรอส่ง/ส่งไม่สำเร็จให้ผู้ดูแล การที่บริการรับอีเมลแล้วไม่ใช่หลักฐานว่าเข้า inbox หากบริการรับแล้วแต่ Worker หยุดก่อนบันทึกผล อาจเกิดอีเมลซ้ำเมื่อ retry ได้

ก่อนเปิดจริงให้ทดสอบการส่ง/ฟื้นตัวกับกล่องที่ผู้ใช้ยืนยัน รวมถึง Google login จริง ตอนนี้ทดสอบกฎเหล่านี้ด้วยระบบจำลองเท่านั้น

## เปิดหน้างานทีมหนึ่งกลุ่ม

1. ปล่อยหน้าสถานะจากโค้ดที่ Merge แล้วก่อน โดยให้ `work.enabled` ใน `.deployment.local.json` เป็น `false` หรือยังไม่มี `work` รัน `node warroom/deploy.mjs --check-existing --wrangler-auth` เพื่อตรวจ Worker/D1 การตั้งค่า Google อีเมล และ cron เดิม จากนั้นใช้ `--apply --existing-only --wrangler-auth` หลัง build
2. เลือกกลุ่มหนึ่งกลุ่มจาก `WATCH_GROUPS` บนเครื่องบอท และยืนยันเจ้าของบัญชี Google ที่เคยเข้าสู่ Warroom แล้ว เทียบกับสมาชิก WhatsApp ในกลุ่ม เก็บค่าจริงในไฟล์ส่วนตัวเท่านั้น
3. เตรียม `data/warroom-work.local.json` (permission 0600) ด้วย `pilot` และ `memberKey` ที่สุ่มแบบ UUID v4 พร้อม `groupJid` และ `memberJid` ของสมาชิกที่ตรวจแล้ว ใส่ `pilot` กับ `memberKey` เดียวกันใน `work` ของ `.deployment.local.json` พร้อม `enabled: true` และ `token` แบบ hex สุ่ม 32 ไบต์แยกจากกุญแจส่งสถานะ
4. Deploy ด้วย `--apply --existing-only --grant-work-owner --wrangler-auth` เพื่อให้สิทธิ์เฉพาะบัญชีผู้ดูแลที่ตั้งไว้และยืนยัน Google แล้ว ตั้ง `WARROOM_WORK_TOKEN` ใน `.env` ให้ตรงกัน แล้วรีสตาร์ตบอทที่รันผ่าน launchd ตัวเดิม บอทจะส่งรายการเมื่อยืนยันกลุ่มและสมาชิกกับ WhatsApp ได้ เปิด `/work` ด้วยบัญชีที่จับคู่ หากเป็นเซสชันเก่าให้เข้าสู่ระบบ Google ใหม่หนึ่งครั้ง

งานบนเว็บครอบคลุมงานเปิดและงานเสร็จวันนี้ตามเวลา Bangkok ชื่อเรื่อง ผู้รับผิดชอบ และชื่อโครงการใช้ดูรายการ ส่วนเบอร์ รหัส WhatsApp และลิงก์ที่ติดมากับข้อความจะถูกตัดออกก่อนซิงก์ งานที่มีเพียงชื่อผู้รับผิดชอบยังดูจากรายการกลุ่มได้ การกดเสร็จจะหยุดการเตือนแบบครั้งเดียวของงานและสะท้อนในคำสั่งกับรายงานตามรอบ

หากเปลี่ยนบัญชีหรือกลุ่ม ให้ปิดและล้างรอบทดลองเดิมก่อน แล้วสุ่ม `pilot`, `memberKey` และ `token` ชุดใหม่

ถ้าซิงก์ขาดเกิน 45 วินาที เว็บให้เปิดอ่านรายการล่าสุดได้สูงสุด 24 ชั่วโมงนับจากหลักฐานล่าสุดของบอท เมื่อหมดอายุเว็บซ่อนรายการและ D1 ล้างสำเนาตามรอบตรวจ สำเนาสำรองของ Cloudflare มีอายุตามแผนบริการ คำสั่ง `/ลบข้อมูล` ล้างสำเนา Warroom ด้วย โดยบอทแจ้งสถานะรอล้างเมื่อส่งคำขอไปเว็บไม่ถึง

**ถอนสิทธิ์หรือปิดทดลอง:** ใน **สมาชิก → สิทธิ์งานทีม** ใช้ปุ่มถอนสิทธิ์เพื่อล้างสำเนาและเพิกถอนเฉพาะสิทธิ์ Work จากเว็บ สำหรับปิดทั้งการเชื่อมต่อให้ตั้ง `work.enabled` เป็น `false` แล้ว deploy ด้วย `--apply --existing-only --purge-work --wrangler-auth` จากนั้นเอา `WARROOM_WORK_TOKEN` ออกจาก `.env` และรีสตาร์ตบอท รายการงานใน SQLite ยังเป็นรายการเดียวกับที่ WhatsApp ใช้

## ผลทดสอบและข้อจำกัด

- Offline bot tests 64 ผ่าน และ Warroom tests 16 ผ่าน รวมสิทธิ์, CSRF, last admin, replay, privacy, AI streak, outage/restart, pause expiry, email retry และ pagination
- Browser ตรวจคอม/มือถือ รวมเพิ่มสมาชิกและพัก/กลับมาแจ้งเตือนด้วยข้อมูลจำลอง
- Production ตรวจ assets/security headers, anonymous 401, `/__demo` 404, ingest จริงกับข้อมูลสังเคราะห์, replay protection, session ทีมและการปฏิเสธ admin API ผ่าน D1 จริง แล้วลบข้อมูลทดสอบทั้งหมด ผู้ดูแลยืนยันเข้าสู่ระบบ Google ได้แล้ว ส่วนการรับอีเมลจริงยังไม่ทดสอบ
- ไม่ยืนยันว่าบอทจริงตอบได้เพียงเพราะเว็บทำงาน ไม่รับประกัน uptime 24 ชั่วโมง การเชื่อมต่อ WhatsApp และเครื่อง Mac ยังเป็นเงื่อนไขแยกกัน

อ้างอิง: [Cloudflare Direct Uploads](https://developers.cloudflare.com/workers/static-assets/direct-upload/), [Email send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/), [Email Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
