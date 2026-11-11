# GeoTag Studio

**GeoTag Studio** menambahkan metadata koordinat GPS (EXIF) ke foto JPG/JPEG. Aplikasi menyediakan dua alur: satu koordinat untuk semua foto, atau pemetaan koordinat dari Excel untuk folder foto bernomor.

## Fitur

- **Mode Satuan:** satu pasangan latitude/longitude diterapkan ke semua foto JPG/JPEG yang dipilih.
- **Mode Batch:** membaca koordinat dari kolom B dan C file `.xlsx`, lalu memasangkannya ke subfolder bernomor `1`, `2`, `3`, dan seterusnya. Kolom D dapat dipakai untuk memberi nama folder hasil, misalnya `Area Utara` menjadi `1. Area Utara`.
- Pratinjau jumlah folder, foto, koordinat, dan status pencocokan sebelum pemrosesan.
- Deteksi kemungkinan titik desimal yang diubah Excel, dengan pemulihan manual dan persetujuan pengguna.
- **Dua format output Mode Batch:** ZIP atau Tampilan Folder. Output ZIP mempertahankan struktur subfolder foto, menyertakan laporan CSV, dan otomatis dibagi dengan target ukuran sekitar 80 MB per bagian. Pembagian dilakukan per folder nomor secara utuh: satu folder sumber hanya masuk ke satu ZIP dan tidak pernah dipotong ke arsip lain. Jika satu folder sendiri lebih besar dari target, folder itu tetap dimasukkan utuh ke satu ZIP tersendiri. Tampilan Folder mengelompokkan foto berdasarkan folder sumber dan memproses satu foto hanya ketika tombol unduhnya ditekan; hasil foto tidak ditahan sekaligus di RAM. Laporan CSV dapat diunduh dari tampilan tersebut.
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
5. Klik proses. Di Chrome/Edge pada situs HTTPS, pilih lokasi simpan pada dialog yang muncul; aplikasi akan menulis ZIP langsung ke lokasi tersebut. Di browser yang belum mendukung penyimpanan langsung, klik **Unduh ZIP** setelah proses selesai.

## Penggunaan — Mode Batch

1. Pilih **Mode Batch**.
2. Unduh template Excel atau siapkan file `.xlsx` sendiri.
3. Isi latitude pada kolom B dan longitude pada kolom C mulai baris 2. Baris 2 dipasangkan dengan folder `1`, baris 3 dengan folder `2`, dan seterusnya. Kolom D opsional untuk nama folder hasil. Contoh: isi `Area Utara` di D2 agar folder hasil bernama `1. Area Utara`. Jika D kosong, nama folder hasil tetap `1`.
4. Pilih folder induk foto. Di dalamnya harus ada subfolder bernomor, misalnya `1`, `2`, `3`. Nama juga boleh langsung ditulis seperti `1. Area Utara`; nomor di depannya tetap dipakai untuk pencocokan. Foto di dalam subfolder lebih dalam juga dibaca.
5. Periksa tabel pratinjau pencocokan. Folder yang nomornya melebihi data koordinat terakhir di Excel akan diabaikan.
6. Bila aplikasi mendeteksi koordinat yang mungkin kehilangan titik desimal, pilih susunan titik yang benar, cocokkan kembali dengan sumber koordinat, lalu centang persetujuan.
7. Pada **Pengaturan hasil batch**, pilih **Unduh ZIP** atau **Tampilan Folder**.
8. Jika memilih ZIP, jalankan pemrosesan. Di Chrome/Edge pada situs HTTPS, tentukan lokasi simpan saat dialog muncul; ZIP akan ditulis langsung ke disk. Di browser lain, unduh ZIP bagian demi bagian. Setiap arsip mencakup laporan CSV.
9. Jika memilih Tampilan Folder, klik tombol proses untuk menampilkan daftar foto yang dikelompokkan per folder. Klik **Unduh foto** pada foto yang diinginkan; foto baru dibaca dan diberi GPS saat tombol tersebut ditekan. Pada Chrome/Edge di situs HTTPS, kamu juga dapat memilih folder tujuan satu kali agar foto tersimpan langsung ke disk dengan struktur subfolder tetap dipertahankan. Tanpa fitur penyimpanan folder langsung, browser mengunduh setiap foto satu per satu dengan nama file yang diberi awalan folder sumber agar tidak bentrok. Laporan CSV tersedia melalui tombol **Unduh laporan CSV**.

## Format koordinat dan pemulihan Excel

- Latitude harus berada pada rentang `-90` sampai `90`. Longitude harus berada pada rentang `-180` sampai `180`.
- Gunakan titik (`.`), bukan koma, sebagai pemisah desimal.
- Template mengatur koordinat sebagai teks agar titik desimal tidak berubah karena pengaturan regional Excel.
- Jika Excel menghapus titik atau mengubahnya menjadi pemisah ribuan, GeoTag Studio menawarkan kandidat pemulihan. Aplikasi tidak otomatis menebak lalu menerapkan koordinat tersebut.
- Pemulihan hanya menyusun kembali kemungkinan posisi titik. Excel dapat membulatkan angka panjang sehingga digit yang hilang tidak selalu dapat dikembalikan. Selalu cocokkan hasil dengan sumber koordinat asli.

## Struktur folder foto untuk Mode Batch

```text
Album_Foto_Bebas/
├── 1/   (atau 1. Area Utara/)
│   ├── foto-a.jpg
│   └── subfolder/foto-b.jpeg
├── 2/
│   └── foto-c.jpg
└── 3/
    └── foto-d.jpg
```

Nama folder induk bebas. Nama subfolder tingkat pertama dapat berupa angka positif (`1`) atau nomor diikuti titik dan nama (`1. Area Utara`). Jika nama subfolder sudah memakai pola nomor + nama, nama itu dipakai otomatis kecuali ditimpa dengan nama pada kolom D Excel. Hanya JPG/JPEG yang diproses; foto di luar subfolder bernomor tidak ikut diproses. Karakter nama yang tidak aman untuk path file akan dibersihkan otomatis.

## Privasi dan batasan

- Tidak ada batas tetap 15 atau 95 foto. Pada Mode Batch output ZIP, aplikasi membagi arsip dengan target sekitar 80 MB data foto sumber per ZIP. Pembagian selalu berdasarkan folder bernomor, bukan berdasarkan foto: seluruh foto dari satu folder tetap bersama di satu ZIP. Di Chrome/Edge pada HTTPS, pengguna memilih folder tujuan satu kali dan setiap ZIP dialirkan langsung ke disk. Browser tanpa dukungan penyimpanan folder langsung membuat ZIP satu per satu. Pada output Tampilan Folder, daftar file hanya menyimpan referensi File dari browser; isi foto baru dibaca dan diproses saat pengguna menekan tombol untuk foto tersebut. Hanya foto yang sedang diproses yang menjadi data hasil sementara. Penyimpanan langsung ke folder tujuan mempertahankan struktur folder; fallback unduhan browser memakai nama file unik dengan awalan folder. Kapasitas praktis tetap bergantung pada memori perangkat/browser dan ruang penyimpanan.
- Pemrosesan berlangsung lokal di browser menggunakan JavaScript dan JSZip. Foto tidak diunggah ke server.
- Tool ini hanya menerima JPG/JPEG dan file Excel `.xlsx` untuk Mode Batch. Format `.xls`, HEIC, PNG, dan RAW tidak didukung.
- Koordinat ditulis ke metadata GPS EXIF. Aplikasi tidak menentukan lokasi foto secara otomatis.
- File hasil mengandung metadata lokasi yang dapat dibaca oleh aplikasi foto atau penerima file. Pastikan koordinat yang digunakan memang boleh dibagikan.
- Pemulihan koordinat Excel harus diverifikasi pengguna; hasil yang salah dapat menempelkan lokasi yang salah pada foto.

## Bahan contoh

Di aplikasi tersedia template Excel, contoh pengisian, dan paket contoh Mode Batch. Foto contoh memakai ilustrasi logo HTML dan hanya digunakan untuk menguji alur, bukan sebagai foto lokasi sebenarnya.

## Lisensi dependency

Library JSZip 3.10.1 disertakan pada `lib/jszip.min.js`. Informasi lisensinya ada di `lib/JSZIP-LICENSE.txt`.

© 2026 Satrio Utomo. All rights reserved.
