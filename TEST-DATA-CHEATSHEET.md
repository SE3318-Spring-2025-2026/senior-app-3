# Senior App Test Data Cheatsheet

Bu dokuman, sunum/demo sirasinda hizli test yapmak icin hazir giris bilgileri ve ornek payload degerlerini listeler.

## 1) Login Bilgileri

### Coordinator
- Email: `coordinator@university.edu`
- Password: `CoordPass1!`

### Profesors (transfer/advisor senaryolari icin)
- `prof.smith@university.edu` (userId: `usr_a1bac0d8`)
- `prof.johnson@university.edu` (userId: `usr_e7bb61e9`)
- Temp password (varsa login icin): `TempPass1!`

## 2) Group Verileri (Canli)

- `Gamma Force` -> `grp_d72a38ac` (leader: `usr_8a733d9b`)
- `Beta Squad` -> `grp_f5fde02b` (leader: `usr_e664118e`)
- `Alpha Team` -> `grp_9d7ee1f4` (leader: `usr_43177890`)

## 3) Override Testi (Coordinator Panel > Overrides)

### Basarili Add Member ornegi
- Group: `Gamma Force (grp_d72a38ac)`
- Action: `Add Member`
- Student ID: `usr_43177890`
- Reason: `override test`

### Alternatif Student UserId degerleri
- `usr_8a733d9b`
- `usr_e664118e`

> Not: `STU-xxxx` formati degil, `usr_...` formatli `userId` girilmeli.

## 4) Advisor Transfer Testi (Coordinator Panel > Advisor Transfer)

### Ornek
- Group: `Alpha Team (grp_9d7ee1f4)`
- New Professor ID: `usr_a1bac0d8`
- Reason: `transfer test`

### Alternatif professor ID
- `usr_e7bb61e9`

## 5) Schedule Window Notlari

Su anda acik:
- `group_creation`
- `member_addition`

Su anda kapali:
- `advisor_association`

Bu nedenle advisor transfer testinde `422` alinabilir.

## 6) Sik Gecen Hata / Cozum

- **"Target student not found"**  
  `Student ID` alanina `usr_...` formatinda var olan bir kullanici ID gir.

- **`422 Unprocessable Entity` transfer isteklerinde**  
  `advisor_association` schedule window acilmadigi icin beklenen davranistir.

- **`404` override isteklerinde**  
  Yanlis group id veya olmayan `target_student_id` kullaniliyor olabilir.

- **"No published committee is linked to this group" (deliverable / teslimat)**  
  Koordinator: grubu bir komiteye baglayip `POST /api/v1/committees/:committeeId/publish` ile yayinlayin. `group.committeeId` dolu ve komitede uyeler olmali.

## 7) Publish cycle (final grade onayi)

- Coordinator: `Coordinator Panel` → gruba git → **Preview & Approve** (`/groups/<groupId>/final-grades/approval`).
- **Publish cycle** alani: opsiyonel etiket (ornek `cycle-2026-sp1`). Bos birakilirsa API genelde otomatik uretir; raporlama icin sabit bir string vermek iyi pratik.
- Onay sonrasi: **Continue to publish** → `/groups/<groupId>/final-grades/publish` sihirbazi ile yayin.

## 8) Professor / advisor — final grade review URL

- Sidebar: **Grade Review** (JWT’de grup yoksa `/professor/grade-review` uzerinden `grp_...` yapistirin).
- Dogrudan: `/groups/<groupId>/final-grades/review` (koordinator oncesinden preview uretmeli).

## 9) Coordinator — bekleyen advisor talepleri

- UI: **Administration → Advisor requests** → `/coordinator/advisor-requests`
- API: `GET /api/v1/advisor-requests/coordinator/pending`, karar: `PATCH /api/v1/advisor-requests/:requestId` (koordinator/admin; professor takvim penceresinden bagimsiz).

## 10) Deliverable — Sprint ID ornekleri

- Genel seed (`scripts/seed-test-general.js`): `sprint_1_1`, `sprint_1_2`, … (`sprint_${i}_${j}`).
- Hafif test seed (`scripts/seed-test-student.js`): `sprint_1`.
- Sprint ID, `SprintConfig` / deadline kayitlariyla eslesmeli; yanlis id ile staging sonrasi adimlarda hata alinabilir.

