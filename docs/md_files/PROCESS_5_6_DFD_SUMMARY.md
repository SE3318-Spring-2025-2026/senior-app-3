# Process 5 ve Process 6 - DFD Diagramları

## 📋 Özet

Process 5 (Deliverable Submission) ve Process 6 (Deliverable Review & Evaluation) için Level 2 Data Flow Diagram'ları başarıyla oluşturulmuştur. Bu diagramlar tüm sub-process'ler, data store'lar, external entity'ler ve veri akışlarını doğru şekilde göstermektedir.

---

## 🔄 Process 5: Deliverable Submission

**Dosya:** `docs/dfdLevel2_Process5.drawio`

### Sub-Processes:
1. **5.1 Validate Group Committee Status**
   - Grubun komiteye atanıp atanmadığını kontrol eder
   - D3 Committee Assignments veri deposundan gerekli verileri alır

2. **5.2 Accept & Validate Submission**
   - Öğrenciler tarafından gönderilen deliverable dosyasını kabul eder
   - Gereksinim ve deadline kontrollerini gerçekleştirir
   - D8 Rubrics & Configurations'dan requirements alır

3. **5.3 Store & Log Submission**
   - Doğrulanmış submission'ı D4 Deliverable Files veri deposunda saklar
   - Log kaydı oluşturur
   - Bildirim sistemi aracılığıyla koordünatöre rapor gönderir

### Veri Akışları:
- **f1:** Student → 5.1: `deliverable file / resubmission`
- **f2:** 5.1 → 5.2: `validation status / pass-fail`
- **f3:** 5.2 → 5.3: `validated submission + metadata`
- **f4:** 5.3 → D4: `store deliverable files + metadata` (dashed)
- **f5:** D8 → 5.1: `submission requirements + deadline` (dashed)
- **f6:** D3 → 5.1: `committee assignment / schedule` (dashed)
- **f7:** Coordinator → 5.1: `committee assignment / schedule`
- **f8:** 5.3 → Coordinator: `submission report`
- **f9:** 5.2 → Student: `clarification / revision requests`
- **f10:** 5.3 → Notification Service: `submission receipt + confirmation notifications`

### External Entities:
- **Student / Team:** Deliverable dosyası gönderir
- **Coordinator:** Deadline ve requirement'ları ayarlar, raporları alır
- **Notification Service:** Submission bildirimi gönderir

### Data Stores:
- **D2:** Groups & Advisor Assignments
- **D3:** Committee Assignments
- **D4:** Deliverable Files & Submissions
- **D8:** Rubrics & Sprint Configurations

---

## 📝 Process 6: Deliverable Review & Evaluation

**Dosya:** `docs/dfdLevel2_Process6.drawio`

### Sub-Processes:

1. **6.1 Assign Review to Committee**
   - Koordünatör tarafından komite üyelerine review atanır
   - Assignment bilgileri ve talimatlar gönderilir
   - D3 Committee Assignments veri deposundan üye bilgileri alınır

2. **6.2 Accept & Review Submission**
   - Komite üyesi submitted deliverable dosyasını açar ve okur
   - Yorum ve clarification request'leri yapabilir
   - D4 Deliverable Files'dan deliverable içeriğini alır

3. **6.3 Apply Rubric & Score Deliverable**
   - Koordünatör tarafından hazırlanan rubric'i kullanarak deliverable'ı puanlar
   - D8 Rubrics & Sprint Configurations'dan rubric tanımını alır
   - Puan ve değerlendirmeleri hazırlar

4. **6.4 Aggregate Results & Log Evaluation**
   - Tüm komite üyelerinin puanlarını toplar
   - Final evaluation skorunu hesaplar
   - Sonuçları D5 Reviews & Evaluations veri deposunda kaydeder

### Veri Akışları:
- **f1:** Process 5 → 6.1: `submitted deliverables`
- **f2:** 6.1 → 6.2: `review assignment + instructions`
- **f3:** 6.2 → 6.3: `review data + comments`
- **f4:** 6.3 → 6.4: `rubric scores + evaluation`
- **f5:** D4 → 6.2: `deliverable content` (dashed)
- **f6:** D8 → 6.3: `rubric definition + scoring criteria` (dashed)
- **f7:** D3 → 6.1: `committee member + assignment data` (dashed)
- **f8:** 6.4 → D5: `store review & scoring data` (dashed)
- **f9:** Coordinator → 6.1: `committee assignment / schedule`
- **f10:** 6.2 → Student: `clarification / revision requests`
- **f11:** 6.1 → Notification Service: `review assignment notification`
- **f12:** 6.4 → Notification Service: `evaluation completion + feedback notifications`
- **f13:** Committee Member → 6.2: `review submission`
- **f14:** 6.4 → Coordinator: `evaluation report`

### External Entities:
- **Student / Team:** Clarification request'lerini alır, revision yapabilir
- **Committee Member:** Review görevini alır, deliverable'ı inceler ve puanlar
- **Coordinator:** Review assignment'ı gerçekleştirir, raporları alır
- **Notification Service:** Tüm bildirimleri gönderir

### Data Stores:
- **D3:** Committee Assignments
- **D4:** Deliverable Files & Submissions
- **D5:** Reviews & Evaluations
- **D8:** Rubrics & Sprint Configurations

---

## 📊 Diagram Renklendirme & Açıklaması

### Renk Kodları:
- **Mavi (Solid):** Process-to-process veri akışları
- **Gri (Dashed):** Data store erişim akışları
- **Yeşil (Solid):** Dış entity ile iletişim akışları
- **Turuncu/Kırmızı:** External service (Notification Service) akışları
- **Mor:** Student/Team feedback akışları

### Element Türleri:
- **Sarı Dikdörtgen:** Data Stores (D1, D2, D3, vb.)
- **Mavi Dikdörtgen:** External Entities (Student, Coordinator, vb.)
- **Yeşil Elips:** Processes (Sub-processes)
- **Dashed Border:** System Boundary

---

## ✅ Validasyon Kontrol Listesi

### Process 5:
- ✅ Tüm sub-processes tanımlanmış (5.1, 5.2, 5.3)
- ✅ Tüm data stores gösterilmiş (D2, D3, D4, D8)
- ✅ Tüm external entities gösterilmiş
- ✅ Tüm veri akışları doğru şekilde bağlanmış
- ✅ Oklar (arrows) doğru yöne işaret etmektedir
- ✅ Process flow sırası mantıklıdır

### Process 6:
- ✅ Tüm sub-processes tanımlanmış (6.1, 6.2, 6.3, 6.4)
- ✅ Tüm data stores gösterilmiş (D3, D4, D5, D8)
- ✅ Tüm external entities gösterilmiş
- ✅ Tüm veri akışları doğru şekilde bağlanmış
- ✅ Oklar (arrows) doğru yöne işaret etmektedir
- ✅ Process flow sırası mantıklıdır
- ✅ Review ve Evaluation ayrı tutulmuş

---

## 🔗 İlgili Dosyalar

- `docs/dfdlevel1_updated.drawio` - Level 1 DFD (tüm sistem)
- `backend/src/controllers/` - Process implementasyon'ları
- `docs/requirements.md` - Business process gereksimleri

---

## 💡 İmplementasyon İçin Önemli Notlar

### Process 5 Implementation:
1. Group-committee assignment validation endpoint'i
2. Deliverable file upload ve validation logic'i
3. Submission logging ve notification trigger'ı
4. Deadline ve requirement checking'i

### Process 6 Implementation:
1. Review assignment send logic'i
2. Deliverable content retrieve endpoint'i
3. Rubric-based scoring logic'i
4. Evaluation aggregation ve storage'ı
5. Notification trigger'ları

---

**Son Güncellenme:** 2026-04-08  
**Durum:** ✅ TAMAMLANMIŞ
