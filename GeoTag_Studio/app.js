/* GeoTag Studio: lossless JPEG EXIF GPS writer + ZIP export. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { files: [], rejectedFiles: [], zipBlob: null, running: false, sourceLabel: '' };
  const { writeExifGps } = window.GeoTagStudioCore || {};
  if (typeof writeExifGps !== 'function') throw new Error('EXIF GPS module tidak berhasil dimuat.');
  const accepted = /\.(jpe?g)$/i;

  const folderInput = $('folderInput');
  const filesInput = $('filesInput');
  const chooseFolderButton = $('chooseFolder');
  const chooseFilesButton = $('chooseFiles');
  const useLocationButton = $('useLocation');
  const dropzone = $('dropzone');
  const latInput = $('latitude');
  const lonInput = $('longitude');
  const processButton = $('processButton');

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function safeZipPath(path) {
    return String(path || 'foto.jpg').replace(/\\/g, '/').split('/').filter(part => part && part !== '.' && part !== '..').join('/');
  }

  function uniqueZipPath(inputPath, usedPaths) {
    const clean = safeZipPath(inputPath) || 'foto.jpg';
    if (!usedPaths.has(clean.toLowerCase())) {
      usedPaths.add(clean.toLowerCase());
      return clean;
    }
    const slash = clean.lastIndexOf('/');
    const folder = slash >= 0 ? clean.slice(0, slash + 1) : '';
    const filename = slash >= 0 ? clean.slice(slash + 1) : clean;
    const dot = filename.lastIndexOf('.');
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot) : '';
    let suffix = 2;
    let candidate;
    do { candidate = `${folder}${stem} (${suffix++})${ext}`; } while (usedPaths.has(candidate.toLowerCase()));
    usedPaths.add(candidate.toLowerCase());
    return candidate;
  }

  function csvCell(value, protectFormula = false) {
    let text = String(value ?? '');
    if (protectFormula && /^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function updateCoordinatePreview() {
    const rawLat = latInput.value.trim();
    const rawLon = lonInput.value.trim();
    const lat = Number(rawLat);
    const lon = Number(rawLon);
    const valid = rawLat !== '' && rawLon !== '' && Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
    const preview = $('locationPreview');
    preview.replaceChildren();

    const pin = document.createElement('span');
    pin.className = 'location-pin';
    pin.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>';
    const text = document.createElement('div');
    const title = document.createElement('strong');
    const detail = document.createElement('span');

    if (valid) {
      title.textContent = 'Koordinat siap digunakan';
      detail.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)} · WGS-84`;
      const map = document.createElement('a');
      map.href = `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lon)}`;
      map.target = '_blank';
      map.rel = 'noopener noreferrer';
      map.textContent = 'Lihat di peta';
      map.className = 'map-link';
      text.append(title, detail, map);
      $('coordinateHint').textContent = 'Koordinat valid. Nilai yang sama akan ditulis ke metadata GPS seluruh foto.';
      $('coordinateHint').classList.remove('field-error');
    } else {
      title.textContent = 'Lokasi belum diatur';
      detail.textContent = 'Koordinat akan diterapkan sama ke seluruh foto.';
      text.append(title, detail);
      $('coordinateHint').textContent = 'Gunakan koordinat desimal dari Google Maps atau sumber GPS lainnya.';
      $('coordinateHint').classList.remove('field-error');
    }
    preview.append(pin, text);
    latInput.closest('.input-wrap').classList.remove('input-invalid');
    lonInput.closest('.input-wrap').classList.remove('input-invalid');
    validateReady();
  }

  function getCoordinates(showMessage = false) {
    const rawLat = latInput.value.trim();
    const rawLon = lonInput.value.trim();
    const lat = Number(rawLat);
    const lon = Number(rawLon);
    const latValid = rawLat !== '' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
    const lonValid = rawLon !== '' && Number.isFinite(lon) && lon >= -180 && lon <= 180;
    const valid = latValid && lonValid;
    latInput.closest('.input-wrap').classList.toggle('input-invalid', showMessage && !latValid);
    lonInput.closest('.input-wrap').classList.toggle('input-invalid', showMessage && !lonValid);
    if (!valid && showMessage) {
      $('coordinateHint').textContent = 'Periksa koordinat: latitude harus −90 hingga 90 dan longitude −180 hingga 180.';
      $('coordinateHint').classList.add('field-error');
      (latValid ? lonInput : latInput).focus();
    }
    return valid ? { lat, lon } : null;
  }

  function validateReady() {
    const hasFiles = state.files.length > 0;
    const hasCoords = !!getCoordinates(false);
    processButton.disabled = !hasFiles || !hasCoords || state.running;
    $('buttonLabel').textContent = state.running ? 'Sedang memproses...' : !hasFiles ? 'Pilih foto untuk memulai' : !hasCoords ? 'Masukkan koordinat GPS' : `Proses ${state.files.length} foto & unduh ZIP`;
  }

  function showFiles(fileList, sourceLabel) {
    const all = Array.from(fileList || []).filter(file => file && file.name);
    state.files = all.filter(file => accepted.test(file.name));
    state.rejectedFiles = all.filter(file => !accepted.test(file.name));
    state.sourceLabel = sourceLabel || 'Foto terpilih';
    state.zipBlob = null;
    $('resultCard').classList.add('hidden');
    $('progressCard').classList.add('hidden');

    if (!state.files.length) {
      $('fileSummary').classList.add('hidden');
      $('previewList').classList.add('hidden');
      $('fileWarning').classList.toggle('hidden', state.rejectedFiles.length === 0);
      $('fileWarning').textContent = state.rejectedFiles.length
        ? `${state.rejectedFiles.length} file diabaikan. GeoTag Studio hanya memproses JPG/JPEG.`
        : 'Belum ada foto yang dipilih.';
      $('dropTitle').textContent = 'Tidak ada foto JPG/JPEG ditemukan';
      $('dropHint').textContent = 'Pilih folder atau beberapa foto JPG/JPEG.';
      validateReady();
      return;
    }

    const sorted = state.files.slice().sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));
    state.files = sorted;
    $('dropTitle').textContent = 'Foto berhasil dipilih';
    $('dropHint').textContent = `${state.files.length} foto JPG/JPEG siap diproses`;
    $('folderName').textContent = state.sourceLabel;
    const total = state.files.reduce((sum, f) => sum + f.size, 0);
    const skippedLabel = state.rejectedFiles.length ? ` · ${state.rejectedFiles.length} file non-JPG diabaikan` : '';
    $('folderMeta').textContent = `${state.files.length} foto · ${formatBytes(total)}${skippedLabel}`;
    $('fileSummary').classList.remove('hidden');

    const warning = $('fileWarning');
    if (total > 150 * 1024 * 1024) {
      warning.textContent = `Total foto ${formatBytes(total)}. Proses ZIP dapat membutuhkan RAM cukup besar; untuk perangkat dengan memori terbatas, pertimbangkan memproses folder dalam beberapa batch.`;
      warning.classList.remove('hidden');
    } else if (state.rejectedFiles.length) {
      warning.textContent = `${state.rejectedFiles.length} file non-JPG/JPEG akan dilewati dan tidak dimasukkan ke ZIP.`;
      warning.classList.remove('hidden');
    } else {
      warning.classList.add('hidden');
      warning.textContent = '';
    }

    const preview = $('previewList');
    preview.replaceChildren();
    const shown = state.files.slice(0, 5);
    for (const file of shown) {
      const item = document.createElement('div');
      item.className = 'preview-item';
      const icon = document.createElement('span'); icon.className = 'mini-file'; icon.textContent = 'JPG';
      const name = document.createElement('span'); name.className = 'preview-name'; name.textContent = file.webkitRelativePath || file.name;
      const size = document.createElement('span'); size.className = 'preview-size'; size.textContent = formatBytes(file.size);
      item.append(icon, name, size); preview.append(item);
    }
    if (state.files.length > shown.length) {
      const more = document.createElement('div'); more.className = 'preview-item'; more.textContent = `+ ${state.files.length - shown.length} foto lainnya`; preview.append(more);
    }
    preview.classList.remove('hidden');
    validateReady();
  }

  function updateProgress(done, total, current) {
    const percent = total ? Math.round(done / total * 100) : 0;
    $('progressPercent').textContent = `${percent}%`;
    $('progressFill').style.width = `${percent}%`;
    $('progressCount').textContent = `${done} dari ${total} foto`;
    $('progressStatus').textContent = done === total ? 'Selesai' : 'Sedang bekerja';
    $('currentFile').textContent = current || '';
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function processPhotos() {
    if (state.running || !state.files.length) return;
    const coords = getCoordinates(true);
    if (!coords) return;
    if (typeof JSZip === 'undefined') {
      alert('Library ZIP tidak ditemukan. Pastikan folder lib dan file jszip.min.js tidak dipindahkan.');
      return;
    }
    state.running = true; state.zipBlob = null; validateReady();
    $('resultCard').classList.add('hidden');
    $('progressCard').classList.remove('hidden');
    $('progressTitle').textContent = 'Memproses foto...';
    $('progressFill').style.width = '0%';
    $('progressPercent').textContent = '0%';
    $('progressCount').textContent = `0 dari ${state.files.length} foto`;
    $('progressStatus').textContent = 'Menyiapkan...';

    const zip = new JSZip();
    const report = [['nama_file','status','latitude','longitude','ukuran_asli','pesan']];
    const usedPaths = new Set();
    for (const skipped of state.rejectedFiles) report.push([skipped.webkitRelativePath || skipped.name, 'DIABAIKAN', '', '', skipped.size, 'Hanya JPG/JPEG yang diproses']);
    let success = 0, failed = 0;
    for (let i = 0; i < state.files.length; i++) {
      const file = state.files[i];
      const relative = uniqueZipPath(file.webkitRelativePath || file.name, usedPaths);
      $('currentFile').textContent = relative;
      try {
        const input = new Uint8Array(await file.arrayBuffer());
        const tagged = writeExifGps(input, coords.lat, coords.lon);
        zip.file(relative, tagged, { binary: true, date: file.lastModified ? new Date(file.lastModified) : new Date() });
        success++;
        report.push([relative,'BERHASIL',coords.lat,coords.lon,file.size,'GPS EXIF berhasil ditambahkan']);
      } catch (error) {
        failed++;
        // Keep a failed file in the ZIP as the original, so no selected image is silently omitted.
        zip.file(relative, file, { date: file.lastModified ? new Date(file.lastModified) : new Date() });
        report.push([relative,'GAGAL',coords.lat,coords.lon,file.size,String(error && error.message ? error.message : error)]);
      }
      updateProgress(i + 1, state.files.length, relative);
      // Yield to the browser so progress and UI remain responsive.
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    report.push([]);
    report.push(['Ringkasan','', '', '', '', 'Foto berhasil: ' + success + '; gagal: ' + failed]);
    const csv = report.map(row => row.map((value, index) => csvCell(value, index === 0 || index === 5)).join(',')).join('\r\n');
    zip.file('laporan_geotag.csv', '\ufeff' + csv);
    $('progressStatus').textContent = 'Membuat file ZIP...';
    $('currentFile').textContent = 'Mengemas foto dan laporan...';
    try {
      state.zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, meta => {
        const p = Math.round(meta.percent || 0);
        $('progressStatus').textContent = `Mengemas ZIP ${p}%`;
      });
      const baseName = ($('zipName').value.trim() || 'hasil_geotag_foto').replace(/[\\/:*?"<>|]/g, '_').replace(/\.zip$/i, '');
      const filename = `${baseName}.zip`;
      downloadBlob(state.zipBlob, filename);
      $('progressTitle').textContent = 'Proses selesai';
      $('progressStatus').textContent = 'ZIP berhasil dibuat';
      $('progressCount').textContent = `${success} berhasil · ${failed} gagal`;
      $('progressPercent').textContent = '100%';
      $('progressFill').style.width = '100%';
      $('resultSummary').textContent = failed === 0
        ? `${success} foto berhasil diberi metadata GPS. File ZIP sudah diunduh.`
        : `${success} foto berhasil diberi GPS, ${failed} foto tidak dapat diubah dan tetap disertakan sebagai file asli dalam ZIP.`;
      $('resultDetails').innerHTML = `<span><strong>${success}</strong> berhasil</span><span><strong>${failed}</strong> gagal</span><span><strong>${formatBytes(state.zipBlob.size)}</strong> ukuran ZIP</span>`;
      $('resultCard').classList.remove('hidden');
    } catch (error) {
      alert('Gagal membuat ZIP: ' + (error.message || error));
      $('progressStatus').textContent = 'Gagal membuat ZIP';
    } finally {
      state.running = false; validateReady();
    }
  }

  folderInput.addEventListener('change', () => {
    const files = Array.from(folderInput.files || []);
    const folder = files[0]?.webkitRelativePath?.split('/')[0] || 'Folder foto';
    showFiles(files, folder);
    folderInput.value = '';
  });
  filesInput.addEventListener('change', () => {
    const files = Array.from(filesInput.files || []);
    showFiles(files, `${files.length} foto dipilih`);
    filesInput.value = '';
  });
  chooseFolderButton.addEventListener('click', (event) => { event.stopPropagation(); folderInput.click(); });
  chooseFilesButton.addEventListener('click', (event) => { event.stopPropagation(); filesInput.click(); });
  $('changeFolder').addEventListener('click', () => { folderInput.click(); });
  latInput.addEventListener('input', updateCoordinatePreview);
  lonInput.addEventListener('input', updateCoordinatePreview);
  processButton.addEventListener('click', processPhotos);
  $('downloadAgain').addEventListener('click', () => {
    if (!state.zipBlob) return;
    const baseName = ($('zipName').value.trim() || 'hasil_geotag_foto').replace(/[\\/:*?"<>|]/g, '_').replace(/\.zip$/i, '');
    downloadBlob(state.zipBlob, `${baseName}.zip`);
  });

  useLocationButton.addEventListener('click', () => {
    if (!navigator.geolocation) {
      $('coordinateHint').textContent = 'Browser ini tidak menyediakan akses lokasi. Masukkan koordinat secara manual.';
      $('coordinateHint').classList.add('field-error');
      return;
    }
    if (!window.isSecureContext) {
      $('coordinateHint').textContent = 'Akses lokasi memerlukan HTTPS atau localhost. Masukkan koordinat secara manual.';
      $('coordinateHint').classList.add('field-error');
      return;
    }
    useLocationButton.disabled = true;
    useLocationButton.textContent = 'Meminta izin lokasi...';
    navigator.geolocation.getCurrentPosition((position) => {
      latInput.value = position.coords.latitude.toFixed(6);
      lonInput.value = position.coords.longitude.toFixed(6);
      updateCoordinatePreview();
      $('coordinateHint').textContent = `Lokasi perangkat terbaca (akurasi ±${Math.round(position.coords.accuracy)} m). Periksa kembali sebelum menerapkan ke foto.`;
      useLocationButton.disabled = false;
      useLocationButton.textContent = 'Gunakan lokasi perangkat';
    }, (error) => {
      const messages = {
        1: 'Izin lokasi ditolak. Kamu tetap bisa memasukkan koordinat secara manual.',
        2: 'Lokasi tidak tersedia. Coba lagi atau masukkan koordinat manual.',
        3: 'Permintaan lokasi melewati batas waktu. Coba lagi.'
      };
      $('coordinateHint').textContent = messages[error.code] || 'Lokasi tidak berhasil dibaca. Masukkan koordinat secara manual.';
      $('coordinateHint').classList.add('field-error');
      useLocationButton.disabled = false;
      useLocationButton.textContent = 'Coba gunakan lokasi lagi';
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });

  dropzone.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    folderInput.click();
  });
  dropzone.addEventListener('keydown', event => {
    if (event.target !== dropzone) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); folderInput.click(); }
  });
  ['dragenter','dragover'].forEach(name => dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(name => dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', event => {
    const files = Array.from(event.dataTransfer?.files || []);
    showFiles(files, 'Foto dari drag & drop');
  });

  // Core EXIF GPS writer is loaded from exif-gps.js for independent testing.
  updateCoordinatePreview();
})();
