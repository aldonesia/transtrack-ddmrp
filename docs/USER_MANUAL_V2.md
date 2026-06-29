# Panduan pengguna — Perencanaan buffer v2 (IDAS)

**Aplikasi IDAS:** [https://transtrack-ddmrp.skom.my.id](https://transtrack-ddmrp.skom.my.id)

Panduan ini menjelaskan **cara kerja buffer versi 2 (v2)** dalam bahasa sederhana. Jika Anda mengintegrasikan IDAS dengan ERP lewat program/API, baca juga [Panduan API integrasi v2](./INTEGRATION_API_MANUAL_V2.md).

---

## 1. Buffer v2 — apa bedanya?

Bayangkan buffer persediaan seperti **tangki air**:

- **Merah (TOR)** — level bahaya; stok terlalu rendah.
- **Kuning (TOY)** — mulai waspada.
- **Hijau (TOG)** — area aman; stok cukup.

**Buffer v2** menghitung ukuran tangki itu dengan cara yang lebih cerdas:

1. Sistem melihat **pola penjualan** barang Anda (lancar, jarang, atau tidak menentu).
2. Menyesuaikan **cara simulasi** — tidak semua barang diperlakukan sama.
3. Memakai **stok awal yang benar** dari data master (bukan asumsi otomatis).
4. Menghitung kebutuhan harian dari **penjualan nyata**, bukan hanya perkiraan.

Hasilnya: rencana buffer dan simulasi harian yang lebih mendekati kondisi lapangan.

> **Catatan:** Menu **Analytics & Buffer** di aplikasi web saat ini masih memakai mesin **versi 1**. Buffer **v2** dijalankan lewat **integrasi API** (biasanya oleh tim IT/ERP). Data master yang Anda isi di aplikasi tetap dipakai oleh v2.

---

## 2. Siapa yang perlu membaca panduan ini?

| Peran | Yang perlu dilakukan |
|-------|----------------------|
| **Admin master data** | Mengisi kolom baru di Master SKU (bagian 3) |
| **Perencana persediaan** | Memahami arti ringkasan hasil (bagian 5) |
| **Tim ERP / IT** | Menjalankan API — lihat [INTEGRATION_API_MANUAL_V2.md](./INTEGRATION_API_MANUAL_V2.md) |

---

## 3. Data master — tiga kolom penting untuk v2

Sebelum buffer v2 bisa dijalankan untuk suatu SKU, master harus lengkap. Selain kolom biasa (kode barang, lead time, MOQ, harga, dll.), pastikan **tiga kolom ini** terisi:

| Kolom di Master Data | Arti sederhana | Contoh |
|----------------------|----------------|--------|
| **Initial Inventory** | Berapa stok Anda **hari ini** (atau saat mulai simulasi) | `2` unit |
| **Qmax** | Batas maksimum qty per order (kosongkan jika tidak ada batas) | `1` atau kosong |
| **Target Percentile** | Seberapa “aman” target stok untuk barang yang jarang laku | `98%` |

### Mengapa Initial Inventory wajib?

Tanpa angka stok awal, sistem tidak tahu dari mana simulasi harian dimulai — seperti menghitung sisa air di tangki tanpa tahu isi awalnya. Jika kolom ini kosong, proses v2 **akan ditolak** untuk SKU tersebut.

### Cara mengisi lewat aplikasi

1. Buka [https://transtrack-ddmrp.skom.my.id/master](https://transtrack-ddmrp.skom.my.id/master) (**Master Data**).
2. Unggah file Excel/CSV master **21 kolom**, atau edit baris per SKU.
3. Periksa setiap SKU yang akan diproses v2: kolom **Initial Inventory** harus berisi angka ≥ 0.
4. Buka [https://transtrack-ddmrp.skom.my.id/master/demand](https://transtrack-ddmrp.skom.my.id/master/demand) (**Master Demand**) dan pastikan riwayat penjualan harian sudah ada.

**Contoh SKU untuk uji:** `100008503` — Initial Inventory = 2, Target Percentile = 98%.

---

## 4. Dua jenis pola barang (ringkas)

Sistem mengelompokkan barang berdasarkan seberapa **sering** dan **menentu** penjualannya:

| Pola | Kira-kira seperti… | Cara hitung buffer v2 |
|------|--------------------|------------------------|
| Lancar / teratur | Minuman harian | **DDMRP** standar |
| Jarang / tidak menentu | Spare part langka | **DDMRP kondisional** (pakai Target Percentile) |

Anda tidak perlu menghitung ini manual — sistem memilih otomatis setelah melihat data penjualan.

---

## 5. Apa yang Anda terima setelah buffer v2 dijalankan?

Tim integrasi menjalankan proses lewat API. Untuk Anda sebagai pengguna, yang penting adalah **dua jenis output**:

### A. Ringkasan angka (seperti laporan satu halaman)

Contoh untuk SKU `100008503`:

```
Method            : DDMRP_CONDITIONAL
VF                : 0.4750
LTF               : 0.3000
Initial Inventory : 2.0
ADU               : 0.0132
TOR               : 0.09
TOY               : 0.71
TOG               : 1.71
Target Percentile : 0.98
Target Level      : 2.00
Fill Rate         : 100.00%
Total Cost        : Rp3,682,598
Jumlah Order      : 3
```

**Cara membaca cepat:**

| Istilah | Arti untuk Anda |
|---------|-----------------|
| **ADU** | Rata-rata pemakaian per hari |
| **TOR / TOY / TOG** | Batas zona buffer (merah / kuning / hijau) |
| **Fill Rate** | Seberapa banyak permintaan terpenuhi (mendekati 100% = bagus) |
| **Total Cost** | Perkiraan total biaya (simpan + order + penalti) |
| **Jumlah Order** | Berapa kali sistem mengusulkan order dalam simulasi |

### B. Tabel simulasi per hari

Satu baris = satu hari: permintaan, stok akhir, zona (RED/YELLOW/GREEN), qty order, dll.

Bisa diekspor ke **Excel (CSV)** untuk analisa manual — tim IT memakai opsi `csv=true` di API (lihat panduan integrasi).

### Rekomendasi order harian (replenishment)

Setelah buffer v2 tersimpan, sistem bisa memberi **saran order per hari** untuk jendela lead time — sama seperti menu Replenishment, tetapi dari rencana **v2** (stok awal operasional mengikuti **Initial Inventory** Anda).

---

## 6. Versi 1 atau versi 2?

| Situasi Anda | Pakai |
|--------------|-------|
| ERP sudah terhubung lama, belum ada rencana ubah | **v1** (tetap) |
| Proyek baru, butuh simulasi harian + export Excel | **v2** |
| Butuh stok awal dari master, bukan asumsi otomatis | **v2** |
| Hanya pakai tombol di halaman Analytics | **v1** (sampai UI v2 tersedia) |

Keduanya bisa jalan bersamaan untuk SKU berbeda. Rencana v2 di sistem ditandai versi **`v2-…`**.

---

## 7. Masalah umum

| Yang Anda lihat | Kemungkinan penyebab | Apa yang dilakukan |
|-----------------|----------------------|-------------------|
| Proses ditolak, pesan tentang **initial inventory** | Kolom Initial Inventory kosong di master | Isi di Master Data, lalu jalankan ulang |
| Tidak ada hasil v2 | Belum pernah dijalankan v2 untuk SKU itu | Minta tim IT jalankan API v2 |
| Rekomendasi order tidak muncul (v2) | Buffer aktif masih dari versi 1 | Jalankan ulang buffer v2 untuk SKU tersebut |
| Angka buffer terasa aneh | Data demand belum lengkap atau stok awal salah | Periksa Master Demand dan Initial Inventory |

Untuk detail teknis API (kode error, parameter), lihat [INTEGRATION_API_MANUAL_V2.md](./INTEGRATION_API_MANUAL_V2.md).

---

## Dokumen terkait

- [USER_MANUAL.md](./USER_MANUAL.md) — panduan aplikasi (menu, Analytics, Replenishment)
- [INTEGRATION_API_MANUAL_V2.md](./INTEGRATION_API_MANUAL_V2.md) — panduan API untuk tim ERP/IT
