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

