# GeoTag Studio

**GeoTag Studio** menambahkan koordinat GPS (WGS-84) ke metadata EXIF banyak foto JPEG/JPG sekaligus. Aplikasi berjalan lokal di browser: foto tidak dikirim ke server. Hasilnya diunduh sebagai ZIP, sedangkan file asli pada perangkat tidak diubah.

## Fitur

- Memilih satu folder beserta subfolder, memilih beberapa foto secara individual, atau drag-and-drop foto.
- Memasukkan latitude dan longitude dalam derajat desimal.
- Mengambil koordinat perangkat saat ini secara opsional melalui izin geolocation browser. Posisi perangkat saat ini belum tentu sama dengan tempat foto diambil; periksa kembali koordinat sebelum memproses.
- Menambahkan atau memperbarui GPS IFD pada metadata EXIF JPEG tanpa mengode ulang aliran gambar JPEG.
- Mempertahankan struktur subfolder saat folder dipilih.
- Menyimpan foto yang gagal diproses sebagai file asli di ZIP dan mencatat statusnya di `laporan_geotag.csv`.
- Menghindari tabrakan nama file dalam ZIP dengan menambahkan akhiran `(2)`, `(3)`, dan seterusnya.
- Menyediakan progres, ringkasan hasil, unduh ulang ZIP, dan tautan untuk melihat koordinat di peta.

## Cara menggunakan

1. Buka GeoTag Studio melalui URL Toolspace atau buka `index.html` dengan browser modern.
2. Pilih **Pilih folder** untuk mengambil semua foto dari folder/subfolder, atau **Pilih beberapa foto** untuk memilih file satu per satu. Drag-and-drop juga tersedia.
3. Masukkan latitude dan longitude. Koordinat bisa disalin dari Google Maps. Tombol **Gunakan lokasi perangkat** bersifat opsional dan meminta izin browser.
4. Periksa koordinat yang ditampilkan. Nilai yang sama akan diterapkan pada semua foto dalam batch.
5. Atur nama ZIP, lalu tekan **Proses foto & unduh ZIP**.
6. Ekstrak ZIP hasilnya. Periksa `laporan_geotag.csv` untuk mengetahui foto yang berhasil, gagal, atau diabaikan.

## Format dan batasan

- Input yang diproses: JPEG/JPG (`.jpg`, `.jpeg`). PNG, HEIC/HEIF, WebP, RAW, dan format lain belum didukung.
- Koordinat harus berupa angka desimal: latitude `-90` sampai `90`, longitude `-180` sampai `180`.
- Tool menulis metadata GPS saja. Tool tidak mengubah tanggal/waktu pengambilan foto, alamat, nama lokasi, altitude, atau arah kamera.
- Jika foto sudah memiliki EXIF, data EXIF lama dipertahankan sejauh struktur TIFF/EXIF dapat dibaca; GPS IFD ditambahkan atau diperbarui. Foto dengan EXIF rusak/terlalu besar dapat gagal dan akan disertakan dalam ZIP sebagai file asli.
- Foto yang gagal tidak diberi metadata GPS. Status dan alasan dicatat di CSV.
- ZIP menggunakan penyimpanan tanpa kompresi ulang untuk menghindari pemborosan waktu CPU; ukuran ZIP biasanya mendekati total ukuran foto sumber ditambah metadata/laporan.
- Batch sangat besar dapat membutuhkan RAM besar karena ZIP dibangun di browser. Untuk perangkat dengan memori terbatas, proses foto dalam beberapa batch.
- Pemilihan folder (`webkitdirectory`) paling konsisten pada Chrome/Edge desktop. Pilih beberapa foto sebagai alternatif pada browser yang tidak mendukung pemilihan folder.
- Geolocation browser memerlukan HTTPS atau localhost dan izin eksplisit. Akurasi posisi dipengaruhi perangkat, jaringan, dan lingkungan.

## Privasi

- Foto diproses di browser dan tidak diunggah ke server GeoTag Studio.
- Izin lokasi hanya diminta setelah pengguna menekan tombol lokasi perangkat.
- **Peringatan:** koordinat yang ditambahkan menjadi metadata GPS di dalam foto hasil. Orang lain dapat membaca metadata lokasi setelah file dibagikan. Jangan menambahkan lokasi sensitif jika tidak ingin membagikannya.
- Jangan mengandalkan geolocation perangkat untuk menentukan lokasi historis foto. Gunakan koordinat tempat foto benar-benar diambil.

## Struktur project

```text
GeoTag_Studio/
├── index.html
├── style.css
├── app.js
├── exif-gps.js
├── README.md
├── assets/
│   ├── favicon.svg
│   └── thumbnail.svg
├── lib/
│   ├── jszip.min.js
│   └── JSZIP-LICENSE.txt
└── tests/
    └── geotag-core.test.cjs
```

## Menjalankan test

Memerlukan Node.js 18 atau lebih baru. Dari folder `GeoTag_Studio`:

```bash
node --check app.js
node --check exif-gps.js
node --test tests/geotag-core.test.cjs
```

Test mencakup penambahan GPS WGS-84 ke JPEG tanpa EXIF, memperbarui koordinat yang sudah ada, mempertahankan segmen non-EXIF/data gambar, menolak JPEG invalid, dan validasi rentang koordinat.

## Deploy ke Toolspace

1. Ekstrak ZIP project.
2. Upload folder `GeoTag_Studio` ke root repository `SatrioUtomo874/toolspace-dashboard`, sejajar dengan folder tools lain.
3. Pastikan file `GeoTag_Studio/index.html` berada tepat di lokasi tersebut, bukan di `GeoTag_Studio/GeoTag_Studio/index.html`.
4. Commit ke branch `main` dan tunggu build/deploy Cloudflare selesai.
5. Generator Toolspace membaca metadata `toolspace:*` dari `index.html`. Kartu akan memakai URL `/GeoTag_Studio/` dan thumbnail `assets/thumbnail.svg`.

Metadata katalog ada di bagian `<head>` `index.html`. Tool disetel sebagai `ready` agar kartunya dapat dibuka, dengan label publik **Beta · siap diuji**. Ganti label/status hanya setelah alur pemrosesan benar-benar diuji di browser setelah deployment.

## Library pihak ketiga

- JSZip 3.10.1 disertakan lokal di `lib/jszip.min.js` untuk membuat ZIP. Lisensinya disertakan di `lib/JSZIP-LICENSE.txt`.
- Penulis EXIF GPS minimal berada di `exif-gps.js`; tidak menggunakan API eksternal.
