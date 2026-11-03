# GeoTag Studio

**GeoTag Studio** menambahkan metadata koordinat GPS (EXIF) ke foto JPG/JPEG. Aplikasi menyediakan dua alur: satu koordinat untuk semua foto, atau pemetaan koordinat dari Excel untuk folder foto bernomor.

## Fitur

- **Mode Satuan:** satu pasangan latitude/longitude diterapkan ke semua foto JPG/JPEG yang dipilih.
- **Mode Batch:** membaca koordinat dari kolom B dan C file `.xlsx`, lalu memasangkannya ke subfolder bernomor `1`, `2`, `3`, dan seterusnya.
- Pratinjau jumlah folder, foto, koordinat, dan status pencocokan sebelum pemrosesan.
- Deteksi kemungkinan titik desimal yang diubah Excel, dengan pemulihan manual dan persetujuan pengguna.
- Hasil berupa ZIP, mempertahankan struktur subfolder foto, serta laporan CSV.
- Foto sumber tidak ditimpa; foto yang gagal diberi GPS tetap disertakan sebagai file asli jika dapat dibaca.
- Seluruh pemrosesan dilakukan di browser. Foto dan workbook tidak diunggah ke server.

## Menjalankan di Toolspace

Folder ini dirancang untuk diletakkan langsung di root repository Toolspace dengan nama persis `GeoTag_Studio/`. Kartu katalog dibaca otomatis dari metadata `toolspace:*` di `index.html`; tidak perlu mengedit katalog utama secara manual.

Path publik setelah deploy: `/GeoTag_Studio/`

## Penggunaan — Mode Satuan

1. Pilih **Mode Satuan**.
2. Pilih folder foto atau tarik foto JPG/JPEG ke area pemilihan.
3. Masukkan latitude dan longitude dalam derajat desimal.
4. Gunakan titik (`.`) sebagai pemisah desimal, misalnya `-7.257500` dan `112.752100`.
5. Proses dan unduh ZIP hasilnya.

## Penggunaan — Mode Batch

1. Pilih **Mode Batch**.
2. Unduh template Excel atau siapkan file `.xlsx` sendiri.
3. Isi latitude pada kolom B dan longitude pada kolom C mulai baris 2. Baris 2 dipasangkan dengan folder `1`, baris 3 dengan folder `2`, dan seterusnya.
4. Pilih folder induk foto. Di dalamnya harus ada subfolder dengan nama angka, misalnya `1`, `2`, `3`. Foto di dalam subfolder lebih dalam juga dibaca.
5. Periksa tabel pratinjau pencocokan. Folder yang nomornya melebihi data koordinat terakhir di Excel akan diabaikan.
6. Bila aplikasi mendeteksi koordinat yang mungkin kehilangan titik desimal, pilih susunan titik yang benar, cocokkan kembali dengan sumber koordinat, lalu centang persetujuan.
7. Jalankan pemrosesan dan unduh ZIP hasil beserta `laporan_batch_geotag.csv`.

## Format koordinat dan pemulihan Excel

- Latitude harus berada pada rentang `-90` sampai `90`. Longitude harus berada pada rentang `-180` sampai `180`.
- Gunakan titik (`.`), bukan koma, sebagai pemisah desimal.
- Template mengatur koordinat sebagai teks agar titik desimal tidak berubah karena pengaturan regional Excel.
- Jika Excel menghapus titik atau mengubahnya menjadi pemisah ribuan, GeoTag Studio menawarkan kandidat pemulihan. Aplikasi tidak otomatis menebak lalu menerapkan koordinat tersebut.
- Pemulihan hanya menyusun kembali kemungkinan posisi titik. Excel dapat membulatkan angka panjang sehingga digit yang hilang tidak selalu dapat dikembalikan. Selalu cocokkan hasil dengan sumber koordinat asli.

## Struktur folder foto untuk Mode Batch

```text
Album_Foto_Bebas/
├── 1/
│   ├── foto-a.jpg
│   └── subfolder/foto-b.jpeg
├── 2/
│   └── foto-c.jpg
└── 3/
    └── foto-d.jpg
```

Nama folder induk bebas. Nama subfolder tingkat pertama harus berupa angka positif. Hanya JPG/JPEG yang diproses; foto di luar subfolder bernomor tidak ikut diproses.

## Privasi dan batasan

- Pemrosesan dilakukan lokal di browser menggunakan JavaScript dan JSZip.
- Tool ini hanya menerima JPG/JPEG dan file Excel `.xlsx` untuk Mode Batch. Format `.xls`, HEIC, PNG, dan RAW tidak didukung.
- Koordinat ditulis ke metadata GPS EXIF. Aplikasi tidak menentukan lokasi foto secara otomatis.
- File hasil mengandung metadata lokasi yang dapat dibaca oleh aplikasi foto atau penerima file. Pastikan koordinat yang digunakan memang boleh dibagikan.
- Pemulihan koordinat Excel harus diverifikasi pengguna; hasil yang salah dapat menempelkan lokasi yang salah pada foto.

## Bahan contoh

Di aplikasi tersedia template Excel, contoh pengisian, dan paket contoh Mode Batch. Foto contoh memakai ilustrasi logo HTML dan hanya digunakan untuk menguji alur, bukan sebagai foto lokasi sebenarnya.

## Lisensi dependency

Library JSZip 3.10.1 disertakan pada `lib/jszip.min.js`. Informasi lisensinya ada di `lib/JSZIP-LICENSE.txt`.

© 2026 Satrio Utomo. All rights reserved.
