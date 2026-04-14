# Frontend + Backend Test Run Cheatsheet

Bu dokuman, sunumda "uygulama calisiyor ve testler geciyor" gostermek icin hizli komutlari icerir.

## 0) Ilk Kurulum (tek sefer)

PowerShell'de proje kokunde:

```powershell
cd "C:\Users\MehmetTopbas\Desktop\yaziliminsa\senior-app-3"
```

Backend bagimliliklari:

```powershell
cd backend
npm install
```

Frontend bagimliliklari:

```powershell
cd ..\frontend
npm install
```

---

## 1) Backend calisiyor mu? (demo)

Yeni terminal:

```powershell
cd "C:\Users\MehmetTopbas\Desktop\yaziliminsa\senior-app-3\backend"
npm run dev
```

Beklenen log:
- `Server is running on port 5000`
- `MongoDB connected successfully`

Health check (ayri terminal):

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:5000/health"
```

Beklenen cikti:
- `status: ok`

---

## 2) Frontend calisiyor mu? (demo)

Yeni terminal:

```powershell
cd "C:\Users\MehmetTopbas\Desktop\yaziliminsa\senior-app-3\frontend"
npm start
```

Beklenen log:
- `Local: http://localhost:3000`
- `Compiled successfully!`

Tarayicida ac:
- `http://localhost:3000`

---

## 3) Backend testlerini calistir

```powershell
cd "C:\Users\MehmetTopbas\Desktop\yaziliminsa\senior-app-3\backend"
npm test
```

Tek seferlik belirli test dosyasi:

```powershell
npx jest "src/__tests__/auth.test.js"
```

---

## 4) Frontend testlerini calistir

Tum testler (watch kapali, sunum/CI icin daha uygun):

```powershell
cd "C:\Users\MehmetTopbas\Desktop\yaziliminsa\senior-app-3\frontend"
npm test -- --watchAll=false
```

Tek test dosyasi:

```powershell
npm test -- --watchAll=false --runTestsByPath "src/__tests__/CommitteeE2EFlow.test.js"
```

---

## 5) Hızlı "end-to-end demo" akisi

1. Backend: `npm run dev`
2. Frontend: `npm start`
3. Browser: `http://localhost:3000`
4. Coordinator login yap
5. Coordinator panelde:
   - Groups yukleniyor mu?
   - Committees yukleniyor mu?
6. Son olarak terminalde test komutlarini goster:
   - Backend: `npm test`
   - Frontend: `npm test -- --watchAll=false`

---

## 6) Sik sorunlar

- `EADDRINUSE: port already in use`  
  3000 veya 5000 portunda eski process vardir. Eski terminali kapatip tekrar calistir.

- Frontend aciliyor ama API hatasi var  
  Backend terminalinde `npm run dev` aktif mi kontrol et.

- Transfer islemi `422` donuyor  
  `advisor_association` schedule window kapali olabilir (beklenen davranis).

