/* GeoTag Studio: single-location and Excel-driven batch GPS geotagging. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const accepted = /\.(jpe?g)$/i;
  const state = {
    mode: 'single', files: [], zipBlob: null, zipFilename: 'hasil_geotag_foto.zip', running: false,
    batchExcelName: '', batchCoordinates: new Map(), batchMaxFolder: 0,
    batchGroups: new Map(), batchFolderLabel: '', batchPhotoCount: 0,
    batchUnsortedCount: 0, batchExcelError: '', batchExcelLoading: false,
    batchRecoveryApplied: false, batchRecoveryConfirmed: false, batchExportSession: null,
    batchFolderOutputSession: null
  };

  // Keep each archive comfortably below typical browser-memory pressure.
  const BATCH_ZIP_TARGET_BYTES = 80 * 1024 * 1024;

  const folderInput = $('folderInput');
  const dropzone = $('dropzone');
  const latInput = $('latitude');
  const lonInput = $('longitude');
  const processButton = $('processButton');
  const batchProcessButton = $('batchProcessButton');

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function safeZipPath(path) {
    return String(path || 'foto.jpg').replace(/\\/g, '/').split('/').filter(part => part && part !== '.' && part !== '..').join('/');
  }

  function cleanFolderLabel(value) {
    return String(value || '')
      .normalize('NFC')
      .replace(/[<>:\"/\\|?*\u0000-\u001F]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 80);
  }

  function batchOutputRelativePath(relative, folderNo, folderLabel) {
    const segments = safeZipPath(relative).split('/').filter(Boolean);
    const label = cleanFolderLabel(folderLabel);
    const outputFolder = label ? `${folderNo}. ${label}` : String(folderNo);
    return [outputFolder, ...segments.slice(1)].join('/');
  }

  function cleanZipName(raw, fallback) {
    return (String(raw || '').trim() || fallback).replace(/[\\/:*?"<>|]/g, '_').replace(/\.zip$/i, '') + '.zip';
  }

  function updateCoordinatePreview() {
    const lat = parseCoordinate(latInput.value, -90, 90);
    const lon = parseCoordinate(lonInput.value, -180, 180);
    const valid = lat !== null && lon !== null;
    if (valid) {
      $('locationPreview').innerHTML = `<span class="location-pin"><svg viewBox="0 0 24 24"><path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg></span><div><strong>Koordinat siap digunakan</strong><span>${lat.toFixed(6)}, ${lon.toFixed(6)} · WGS-84</span></div>`;
      $('coordinateHint').textContent = 'Koordinat valid. Nilai yang sama akan ditulis ke metadata GPS seluruh foto.';
      $('coordinateHint').classList.remove('field-error');
    } else {
      $('locationPreview').innerHTML = `<span class="location-pin"><svg viewBox="0 0 24 24"><path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg></span><div><strong>Lokasi belum diatur</strong><span>Koordinat akan diterapkan sama ke seluruh foto.</span></div>`;
      $('coordinateHint').textContent = 'Gunakan titik (.) sebagai pemisah desimal. Contoh: -7.257500 dan 112.752100.';
      $('coordinateHint').classList.remove('field-error');
    }
    validateReady();
  }

  function getCoordinates(showMessage = false) {
    const rawLat = latInput.value.trim();
    const rawLon = lonInput.value.trim();
    const lat = parseCoordinate(rawLat, -90, 90);
    const lon = parseCoordinate(rawLon, -180, 180);
    const valid = lat !== null && lon !== null;
    latInput.closest('.input-wrap').classList.toggle('input-invalid', showMessage && lat === null);
    lonInput.closest('.input-wrap').classList.toggle('input-invalid', showMessage && lon === null);
    if (!valid && showMessage) {
      $('coordinateHint').textContent = 'Gunakan angka desimal dengan titik (.), bukan koma. Latitude −90 hingga 90 dan longitude −180 hingga 180.';
      $('coordinateHint').classList.add('field-error');
      (lat === null ? latInput : lonInput).focus();
    }
    return valid ? { lat, lon } : null;
  }

  function getBatchOutputMode() {
    return document.querySelector('input[name="batchOutputMode"]:checked')?.value || 'zip';
  }

  function updateBatchOutputMode() {
    const mode = getBatchOutputMode();
    document.querySelectorAll('[data-output-option]').forEach(option => {
      const active = option.dataset.outputOption === mode;
      option.classList.toggle('active', active);
      const radio = option.querySelector('input[type="radio"]');
      if (radio) radio.checked = active;
    });
    $('batchZipNameRow').classList.toggle('hidden', mode !== 'zip');
    validateReady();
  }

  function validateReady() {
    const hasFiles = state.files.length > 0;
    const hasCoords = !!getCoordinates(false);
    processButton.disabled = !hasFiles || !hasCoords || state.running;
    $('buttonLabel').textContent = state.running ? 'Sedang memproses...' : !hasFiles ? 'Pilih foto untuk memulai' : !hasCoords ? 'Masukkan koordinat GPS' : `Proses ${state.files.length} foto & unduh ZIP`;
    const hasBatchExcel = !state.batchExcelLoading && !state.batchExcelError && state.batchMaxFolder > 0;
    const hasBatchFolders = state.batchGroups.size > 0;
    const folderNumbers = Array.from(state.batchGroups.keys());
    const hasMatch = folderNumbers.some(folderNo => folderNo <= state.batchMaxFolder && state.batchCoordinates.get(folderNo)?.valid);
    const unresolvedRecovery = folderNumbers.some(folderNo => {
      if (folderNo > state.batchMaxFolder) return false;
      const coord = state.batchCoordinates.get(folderNo);
      return !!(coord && (coord.repairLat?.length || coord.repairLon?.length) && (!coord.recovered || !state.batchRecoveryConfirmed));
    });
    batchProcessButton.disabled = state.running || !hasBatchExcel || !hasBatchFolders || !hasMatch || unresolvedRecovery;
    const eligiblePhotoCount = Array.from(state.batchGroups.entries()).filter(([folderNo]) => folderNo <= state.batchMaxFolder).reduce((sum, [, files]) => sum + files.length, 0);
    const outputAction = getBatchOutputMode() === 'folder' ? 'Tampilkan daftar' : 'Proses & siapkan ZIP';
    $('batchButtonLabel').textContent = state.running ? 'Sedang memproses...' : state.batchExcelLoading ? 'Membaca Excel...' : !state.batchExcelName ? 'Pilih file Excel terlebih dahulu' : !hasBatchFolders ? 'Pilih folder foto terlebih dahulu' : unresolvedRecovery ? 'Periksa dan setujui pemulihan koordinat terlebih dahulu' : !hasMatch ? 'Belum ada pasangan koordinat dan folder yang valid' : `${outputAction} untuk ${eligiblePhotoCount} foto`;
  }

  function setMode(mode) {
    if (state.running) return;
    state.mode = mode;
    document.querySelectorAll('.mode-tab').forEach(button => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $('singleModePanel').classList.toggle('hidden', mode !== 'single');
    $('batchModePanel').classList.toggle('hidden', mode !== 'batch');
    $('resultCard').classList.add('hidden');
    $('progressCard').classList.add('hidden');
    resetBatchPartDownloads();
    state.batchFolderOutputSession = null;
    validateReady();
  }

  function showFiles(fileList, folderLabel) {
    const all = Array.from(fileList || []);
    state.files = all.filter(file => accepted.test(file.name));
    state.zipBlob = null;
    $('resultCard').classList.add('hidden');
    $('progressCard').classList.add('hidden');
    if (!state.files.length) {
      $('fileSummary').classList.add('hidden');
      $('previewList').classList.add('hidden');
      $('dropTitle').textContent = 'Tidak ada foto JPG/JPEG ditemukan';
      $('dropHint').textContent = 'Pilih folder lain atau periksa format fotonya.';
      validateReady();
      return;
    }
    state.files.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));
    $('dropTitle').textContent = 'Folder foto berhasil dipilih';
    $('dropHint').textContent = `${state.files.length} foto JPG/JPEG siap diproses`;
    $('folderName').textContent = folderLabel || (state.files[0].webkitRelativePath ? state.files[0].webkitRelativePath.split('/')[0] : 'Foto terpilih');
    const total = state.files.reduce((sum, f) => sum + f.size, 0);
    $('folderMeta').textContent = `${state.files.length} foto · ${formatBytes(total)}`;
    $('fileSummary').classList.remove('hidden');
    const preview = $('previewList'); preview.innerHTML = '';
    const shown = state.files.slice(0, 4);
    for (const file of shown) {
      const item = document.createElement('div'); item.className = 'preview-item';
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

  // --- Minimal lossless EXIF GPS writer. It appends a new GPS IFD and a copied IFD0,
  //    leaving the original TIFF payload and all existing image bytes untouched. ---
  function writeExifGps(jpegBytes, latitude, longitude) {
    if (!(jpegBytes instanceof Uint8Array)) jpegBytes = new Uint8Array(jpegBytes);
    if (jpegBytes.length < 4 || jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) throw new Error('File bukan JPEG yang valid.');

    const view = new DataView(jpegBytes.buffer, jpegBytes.byteOffset, jpegBytes.byteLength);
    const readU16BE = (p) => view.getUint16(p, false);
    let pos = 2;
    let exif = null;
    while (pos + 4 <= jpegBytes.length) {
      if (jpegBytes[pos] !== 0xff) break;
      const markerStart = pos;
      while (pos < jpegBytes.length && jpegBytes[pos] === 0xff) pos++;
      if (pos >= jpegBytes.length) break;
      const marker = jpegBytes[pos++];
      if (marker === 0xda || marker === 0xd9) break; // SOS / EOI
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // standalone marker
      if (pos + 2 > jpegBytes.length) break;
      const segLength = readU16BE(pos);
      if (segLength < 2 || pos + segLength > jpegBytes.length) throw new Error('Struktur segmen JPEG tidak valid.');
      const payloadStart = pos + 2;
      const segmentEnd = pos + segLength;
      if (marker === 0xe1 && segLength >= 8 && asciiAt(jpegBytes, payloadStart, 'Exif\0\0')) {
        exif = { markerStart, lengthOffset: pos, payloadStart, segmentEnd, tiffStart: payloadStart + 6, tiffLength: segmentEnd - (payloadStart + 6) };
        break;
      }
      pos = segmentEnd;
      if (pos <= markerStart) break;
    }

    let tiff;
    if (exif) {
      tiff = jpegBytes.slice(exif.tiffStart, exif.tiffStart + exif.tiffLength);
    } else {
      // Little-endian TIFF header and an empty IFD0.
      tiff = new Uint8Array([0x49,0x49,0x2a,0x00,0x08,0x00,0x00,0x00, 0x00,0x00, 0x00,0x00,0x00,0x00]);
    }

    const updatedTiff = appendGpsIfd(tiff, latitude, longitude);
    const segmentLength = 8 + updatedTiff.length; // 2-byte length + 6-byte Exif signature + TIFF
    if (segmentLength > 65535) throw new Error('Metadata EXIF foto ini terlalu besar untuk ditambah GPS (batas JPEG 65.535 byte).');
    const segment = new Uint8Array(2 + segmentLength);
    segment[0] = 0xff; segment[1] = 0xe1;
    new DataView(segment.buffer).setUint16(2, segmentLength, false);
    segment.set([0x45,0x78,0x69,0x66,0x00,0x00], 4);
    segment.set(updatedTiff, 10);

    if (exif) {
      const out = new Uint8Array(jpegBytes.length - (exif.segmentEnd - exif.markerStart) + segment.length);
      out.set(jpegBytes.subarray(0, exif.markerStart), 0);
      out.set(segment, exif.markerStart);
      out.set(jpegBytes.subarray(exif.segmentEnd), exif.markerStart + segment.length);
      return out;
    }
    const out = new Uint8Array(jpegBytes.length + segment.length);
    out.set(jpegBytes.subarray(0, 2), 0);
    out.set(segment, 2);
    out.set(jpegBytes.subarray(2), 2 + segment.length);
    return out;
  }

  function asciiAt(bytes, offset, value) {
    for (let i = 0; i < value.length; i++) if (bytes[offset + i] !== value.charCodeAt(i)) return false;
    return true;
  }

  function appendGpsIfd(tiff, lat, lon) {
    if (tiff.length < 8) throw new Error('Header TIFF/EXIF rusak atau tidak lengkap.');
    const little = tiff[0] === 0x49 && tiff[1] === 0x49;
    if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) throw new Error('Byte order EXIF tidak dikenali.');
    const dv = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
    const u16 = (p) => dv.getUint16(p, little);
    const u32 = (p) => dv.getUint32(p, little);
    const put16 = (view, p, v) => view.setUint16(p, v, little);
    const put32 = (view, p, v) => view.setUint32(p, v, little);
    if (u16(2) !== 42) throw new Error('Header TIFF bukan format EXIF standar.');
    const oldIfd0 = u32(4);
    if (oldIfd0 + 2 > tiff.length) throw new Error('IFD0 EXIF berada di luar batas data.');
    const count = u16(oldIfd0);
    const entriesStart = oldIfd0 + 2;
    const entriesEnd = entriesStart + count * 12;
    if (entriesEnd + 4 > tiff.length) throw new Error('Daftar tag EXIF tidak lengkap.');
    const nextIfd = tiff.slice(entriesEnd, entriesEnd + 4);
    const entries = [];
    let hadGpsPointer = false;
    for (let i = 0; i < count; i++) {
      const raw = tiff.slice(entriesStart + i * 12, entriesStart + (i + 1) * 12);
      const tag = little ? raw[0] | (raw[1] << 8) : (raw[0] << 8) | raw[1];
      if (tag === 0x8825) {
        hadGpsPointer = true;
        entries.push({ tag, raw });
      } else entries.push({ tag, raw });
    }
    if (!hadGpsPointer) entries.push({ tag: 0x8825, raw: null });
    if (entries.length > 65535) throw new Error('Jumlah tag EXIF melebihi batas format TIFF.');
    entries.sort((a,b) => a.tag - b.tag);

    const ifd0Offset = align2(tiff.length);
    const ifd0Size = 2 + entries.length * 12 + 4;
    const gpsOffset = align2(ifd0Offset + ifd0Size);
    const gps = buildGpsIfd(gpsOffset, lat, lon, little);
    const output = new Uint8Array(gpsOffset + gps.bytes.length);
    output.set(tiff, 0);
    const outView = new DataView(output.buffer);
    put32(outView, 4, ifd0Offset);
    put16(outView, ifd0Offset, entries.length);
    let cursor = ifd0Offset + 2;
    for (const entry of entries) {
      if (entry.tag === 0x8825) {
        if (entry.raw) output.set(entry.raw, cursor);
        put16(outView, cursor, 0x8825);
        put16(outView, cursor + 2, 4); // GPSInfoIFDPointer is LONG/count 1
        put32(outView, cursor + 4, 1);
        put32(outView, cursor + 8, gpsOffset);
      } else output.set(entry.raw, cursor);
      cursor += 12;
    }
    output.set(nextIfd, cursor);
    output.set(gps.bytes, gpsOffset);
    return output;
  }

  function align2(n) { return (n + 1) & ~1; }

  function buildGpsIfd(gpsOffset, lat, lon, little) {
    const coordinates = [
      { tag: 0x0000, type: 1, count: 4, inline: [2,3,0,0] },
      { tag: 0x0001, type: 2, count: 2, inline: [lat < 0 ? 83 : 78, 0] }, // S/N
      { tag: 0x0002, type: 5, count: 3, rational: toDms(lat) },
      { tag: 0x0003, type: 2, count: 2, inline: [lon < 0 ? 87 : 69, 0] }, // W/E
      { tag: 0x0004, type: 5, count: 3, rational: toDms(lon) },
      { tag: 0x0012, type: 2, count: 7, ascii: [87,71,83,45,56,52,0] } // WGS-84
    ];
    coordinates.sort((a,b) => a.tag - b.tag);
    const dataStart = 2 + coordinates.length * 12;
    let dataLength = 0;
    for (const item of coordinates) {
      if (item.rational) dataLength += 24;
      else if (item.ascii && item.count > 4) dataLength += item.ascii.length;
    }
    const bytes = new Uint8Array(dataStart + dataLength);
    const view = new DataView(bytes.buffer);
    const set16 = (p,v) => view.setUint16(p,v,little);
    const set32 = (p,v) => view.setUint32(p,v,little);
    set16(0, coordinates.length);
    let entryPos = 2;
    let dataPos = dataStart;
    for (const item of coordinates) {
      set16(entryPos, item.tag); set16(entryPos + 2, item.type); set32(entryPos + 4, item.count);
      if (item.inline) {
        const inline = new Uint8Array(4); inline.set(item.inline);
        bytes.set(inline, entryPos + 8);
      } else if (item.rational) {
        set32(entryPos + 8, gpsOffset + dataPos);
        for (const [numerator, denominator] of item.rational) {
          set32(dataPos, numerator); set32(dataPos + 4, denominator); dataPos += 8;
        }
      } else if (item.ascii) {
        set32(entryPos + 8, gpsOffset + dataPos);
        bytes.set(item.ascii, dataPos); dataPos += item.ascii.length;
      }
      entryPos += 12;
    }
    return { bytes };
  }

  function toDms(value) {
    const absolute = Math.abs(value);
    const degrees = Math.floor(absolute);
    const minuteFloat = (absolute - degrees) * 60;
    const minutes = Math.floor(minuteFloat);
    let secondsScaled = Math.round((minuteFloat - minutes) * 60 * 1000000);
    let adjustedDegrees = degrees;
    let adjustedMinutes = minutes;
    if (secondsScaled >= 60000000) { secondsScaled = 0; adjustedMinutes += 1; }
    if (adjustedMinutes >= 60) { adjustedMinutes = 0; adjustedDegrees += 1; }
    const gcd = (a,b) => b ? gcd(b, a % b) : a;
    const divisor = gcd(secondsScaled, 1000000) || 1;
    return [[adjustedDegrees,1],[adjustedMinutes,1],[secondsScaled/divisor,1000000/divisor]];
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
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Keep the object URL alive long enough for large downloads to start and finish.
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
  }

  async function prepareZipOutput(filename) {
    // On Chromium browsers, stream the ZIP straight to disk instead of building
    // one giant Blob in RAM. This API must be invoked from the user's click.
    if (window.isSecureContext && typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }]
        });
        return { fileHandle: handle, cancelled: false };
      } catch (error) {
        if (error && error.name === 'AbortError') return { writable: null, cancelled: true };
        // Unsupported/blocked file access falls back to a normal browser download.
        console.warn('Direct ZIP saving is unavailable; using browser download.', error);
      }
    }
    return { fileHandle: null, cancelled: false };
  }

  function streamZipToWritable(zip, writable) {
    return new Promise((resolve, reject) => {
      const stream = zip.generateInternalStream({
        type: 'uint8array',
        compression: 'STORE',
        streamFiles: true
      });
      let writeQueue = Promise.resolve();
      let bytesWritten = 0;
      let settled = false;

      const fail = async (error) => {
        if (settled) return;
        settled = true;
        try {
          if (typeof writable.abort === 'function') await writable.abort(error);
        } catch (_) { /* preserve the original error */ }
        reject(error);
      };

      stream.on('data', (chunk, metadata) => {
        if (settled) return;
        stream.pause();
        writeQueue = writeQueue.then(async () => {
          await writable.write(chunk);
          bytesWritten += chunk.byteLength || chunk.length || 0;
          const percent = Math.round((metadata && metadata.percent) || 0);
          $('progressStatus').textContent = `Menyimpan ZIP ${percent}%`;
          if (metadata && metadata.currentFile) {
            $('currentFile').textContent = `Mengemas ${metadata.currentFile}`;
          }
        }).then(() => {
          if (!settled) stream.resume();
        }).catch(fail);
      });

      stream.on('error', fail);
      stream.on('end', () => {
        writeQueue.then(async () => {
          if (settled) return;
          await writable.close();
          settled = true;
          resolve(bytesWritten);
        }).catch(fail);
      });
      stream.resume();
    });
  }

  async function exportZip(zip, filename, target) {
    if (target && target.fileHandle) {
      let writable = null;
      try {
        // Create/truncate the destination only after photo processing has succeeded.
        writable = await target.fileHandle.createWritable();
      } catch (error) {
        console.warn('Could not open the selected destination; using browser download.', error);
      }
      if (writable) {
        const size = await streamZipToWritable(zip, writable);
        return { blob: null, size, savedDirectly: true };
      }
    }
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'STORE', streamFiles: true },
      meta => {
        $('progressStatus').textContent = `Membuat ZIP ${Math.round(meta.percent || 0)}%`;
      }
    );
    return { blob, size: blob.size, savedDirectly: false };
  }

  async function chooseBatchOutputDirectory() {
    if (!window.isSecureContext || typeof window.showDirectoryPicker !== 'function') {
      return { directoryHandle: null, cancelled: false };
    }
    try {
      const directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      return { directoryHandle, cancelled: false };
    } catch (error) {
      if (error && error.name === 'AbortError') return { directoryHandle: null, cancelled: true };
      console.warn('Direct folder saving is unavailable; using one-by-one ZIP downloads.', error);
      return { directoryHandle: null, cancelled: false };
    }
  }

  function splitBatchIntoParts(eligibleGroups) {
    // Keep each numbered source folder intact. A folder is never split across ZIPs,
    // even when its total size is larger than the target; oversized folders get
    // their own ZIP so extracting all parts never creates duplicate folder trees.
    const parts = [];
    let current = { items: [], bytes: 0, folderNumbers: [] };

    for (const folderNo of eligibleGroups) {
      const coord = state.batchCoordinates.get(folderNo);
      const files = state.batchGroups.get(folderNo) || [];
      if (!files.length) continue;

      const folderBytes = files.reduce((sum, entry) => sum + (Number(entry.file.size) || 0), 0);
      if (current.items.length && current.bytes + folderBytes > BATCH_ZIP_TARGET_BYTES) {
        parts.push(current);
        current = { items: [], bytes: 0, folderNumbers: [] };
      }

      current.folderNumbers.push(folderNo);
      for (const entry of files) current.items.push({ folderNo, entry, coord });
      current.bytes += folderBytes;

      // If this folder alone reaches/exceeds the target, close this ZIP now.
      // In particular, do not split its photos into separate ZIP archives.
      if (current.bytes >= BATCH_ZIP_TARGET_BYTES) {
        parts.push(current);
        current = { items: [], bytes: 0, folderNumbers: [] };
      }
    }

    if (current.items.length) parts.push(current);
    return parts;
  }

  function batchPartFilename(baseFilename, partIndex, totalParts) {
    const base = String(baseFilename || 'hasil_geotag_batch').replace(/\.zip$/i, '');
    const digits = String(totalParts).length;
    return `${base}_bagian_${String(partIndex + 1).padStart(digits, '0')}_dari_${String(totalParts).padStart(digits, '0')}.zip`;
  }

  async function buildBatchZipPart(part, partIndex, totalParts, progressState, ignoredRows) {
    const zip = new JSZip();
    const report = [['nomor_folder','nama_file','status','latitude','longitude','ukuran_asli','pesan']];
    const partNumber = partIndex + 1;
    let success = 0, failed = 0, skipped = 0, unreadable = 0;

    for (const { folderNo, entry, coord } of part.items) {
      const { file, relative } = entry;
      const folderLabel = cleanFolderLabel(coord?.folderName) || cleanFolderLabel(entry.sourceFolderLabel);
      const outputRelative = batchOutputRelativePath(relative, folderNo, folderLabel);
      $('currentFile').textContent = `ZIP ${partNumber}/${totalParts} · ${outputRelative}`;
      let sourceReadable = false;
      try {
        if (!coord || !coord.valid) {
          zip.file(outputRelative, file, { date: file.lastModified ? new Date(file.lastModified) : new Date() });
          skipped++;
          report.push([folderNo, outputRelative, 'TANPA GPS', coord?.rawLat || '', coord?.rawLon || '', file.size, coord?.reason || 'Baris koordinat untuk folder ini kosong']);
        } else {
          const originalBytes = new Uint8Array(await file.arrayBuffer());
          sourceReadable = true;
          const tagged = writeExifGps(originalBytes, coord.lat, coord.lon);
          zip.file(outputRelative, new Blob([tagged], { type: 'image/jpeg' }), { date: file.lastModified ? new Date(file.lastModified) : new Date() });
          success++;
          report.push([folderNo, outputRelative, 'BERHASIL', coord.lat.toFixed(6), coord.lon.toFixed(6), file.size, coord.recovered ? 'GPS EXIF berhasil ditambahkan menggunakan koordinat hasil pemulihan desimal yang disetujui pengguna' : 'GPS EXIF berhasil ditambahkan']);
        }
      } catch (error) {
        if (sourceReadable) {
          failed++;
          zip.file(outputRelative, file, { date: file.lastModified ? new Date(file.lastModified) : new Date() });
          report.push([folderNo, outputRelative, 'GAGAL', coord?.lat ?? coord?.rawLat ?? '', coord?.lon ?? coord?.rawLon ?? '', file.size, String(error && error.message ? error.message : error)]);
        } else {
          unreadable++;
          report.push([folderNo, outputRelative, 'GAGAL BACA', coord?.rawLat || '', coord?.rawLon || '', file.size, String(error && error.message ? error.message : error)]);
        }
      }
      progressState.done++;
      const photoPercent = Math.min(95, Math.round(progressState.done / progressState.total * 95));
      $('progressPercent').textContent = `${photoPercent}%`;
      $('progressFill').style.width = `${photoPercent}%`;
      $('progressCount').textContent = `${progressState.done} dari ${progressState.total} foto`;
      $('progressStatus').textContent = `Memproses foto · ZIP ${partNumber}/${totalParts}`;
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    if (partIndex === 0 && ignoredRows.length) report.push(...ignoredRows);
    report.push([]);
    const folderList = (part.folderNumbers || []).join(', ');
    report.push(['Ringkasan bagian','','','','','',`Bagian ${partNumber} dari ${totalParts}; folder utuh: ${folderList}; foto dalam bagian: ${part.items.length}; ukuran sumber: ${part.bytes}`]);
    report.push(['Ringkasan hasil','','','','','',`Berhasil: ${success}; gagal: ${failed}; tanpa GPS: ${skipped}; tidak dapat dibaca: ${unreadable}`]);
    report.push(['Catatan','','','','','','Setiap folder nomor dimasukkan utuh ke satu ZIP dan tidak dipecah ke arsip lain. Nama folder keluaran dapat memakai format nomor + titik + nama folder. Ekstrak seluruh ZIP ke folder tujuan yang sama untuk mendapatkan kembali struktur folder.']);
    zip.file(`laporan_batch_geotag_bagian_${String(partNumber).padStart(2, '0')}.csv`, csvText(report));
    zip.file(`INFO_BAGIAN_${String(partNumber).padStart(2, '0')}.txt`, `GeoTag Studio — Hasil Batch\nBagian: ${partNumber} dari ${totalParts}\nFolder utuh di ZIP ini: ${folderList}\nFoto dalam bagian: ${part.items.length}\nUkuran foto sumber bagian: ${formatBytes(part.bytes)}\n\nSetiap folder sumber disimpan utuh di satu ZIP; tidak ada folder yang dipotong ke ZIP lain. Ekstrak seluruh ZIP ke folder tujuan yang sama untuk mengembalikan struktur folder bernomor.\nLaporan CSV untuk bagian ini disertakan di dalam ZIP.\n`);
    return { zip, stats: { success, failed, skipped, unreadable, count: part.items.length } };
  }

  async function saveZipToDirectory(zip, filename, directoryHandle) {
    const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    return streamZipToWritable(zip, writable);
  }

  function resetBatchPartDownloads() {
    const container = $('batchPartDownloads');
    if (container) {
      container.innerHTML = '';
      container.classList.add('hidden');
    }
    const old = state.batchExportSession?.currentPart;
    if (old?.url) URL.revokeObjectURL(old.url);
    state.batchExportSession = null;
    state.batchFolderOutputSession = null;
  }

  function renderBatchFallbackDownloads(session) {
    const container = $('batchPartDownloads');
    container.innerHTML = '';
    container.classList.remove('hidden');
    const intro = document.createElement('p');
    intro.className = 'batch-download-intro';
    intro.textContent = `ZIP dibuat satu per satu agar browser tetap ringan. Target sekitar ${formatBytes(BATCH_ZIP_TARGET_BYTES)} per ZIP, tetapi setiap folder nomor selalu utuh dan hanya muncul di satu ZIP. Folder yang lebih besar dari target tetap disimpan utuh dalam ZIP sendiri. Unduh bagian yang sudah siap, lalu siapkan bagian berikutnya.`;
    container.appendChild(intro);

    const current = session.currentPart;
    if (current && current.blob) {
      const item = document.createElement('div');
      item.className = 'batch-download-item';
      const info = document.createElement('div');
      info.className = 'batch-download-copy';
      const title = document.createElement('strong');
      title.textContent = `Bagian ${current.index + 1} dari ${session.parts.length}`;
      const meta = document.createElement('span');
      meta.textContent = `${current.stats.count} foto · ${formatBytes(current.size)} ZIP`;
      info.append(title, meta);
      const link = document.createElement('a');
      link.className = 'download-button batch-download-link';
      link.href = current.url;
      link.download = current.filename;
      link.textContent = `Unduh ${current.filename}`;
      link.addEventListener('click', () => {
        current.downloaded = true;
        session.downloaded.add(current.index);
        setTimeout(() => {
          if (current.downloaded && current.url) {
            URL.revokeObjectURL(current.url);
            current.url = null;
            current.blob = null;
            link.removeAttribute('href');
            link.textContent = 'Unduhan sudah dimulai';
          }
        }, 120000);
        const nextButton = container.querySelector('[data-next-part]');
        if (nextButton) nextButton.disabled = false;
        const status = container.querySelector('.batch-download-status');
        if (status) status.textContent = current.index + 1 < session.parts.length
          ? 'Unduhan dimulai. Setelah selesai, siapkan bagian berikutnya.'
          : 'Unduhan bagian terakhir dimulai.';
        if (session.downloaded.size === session.parts.length) {
          $('progressPercent').textContent = '100%';
          $('progressFill').style.width = '100%';
          $('progressStatus').textContent = 'Semua bagian sudah diunduh';
        }
      });
      item.append(info, link);
      container.appendChild(item);
    }

    const status = document.createElement('p');
    status.className = 'batch-download-status';
    status.textContent = `${session.downloaded.size} dari ${session.parts.length} ZIP sudah diminta untuk diunduh.`;
    container.appendChild(status);

    if (session.nextIndex < session.parts.length) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'download-button batch-next-button';
      button.dataset.nextPart = 'true';
      button.disabled = !current || !current.downloaded;
      button.textContent = `Siapkan ZIP bagian ${session.nextIndex + 1} dari ${session.parts.length}`;
      button.addEventListener('click', () => prepareFallbackBatchPart(session));
      container.appendChild(button);
    } else if (session.downloaded.size === session.parts.length) {
      const done = document.createElement('p');
      done.className = 'batch-download-done';
      done.textContent = 'Semua bagian sudah diunduh.';
      container.appendChild(done);
    } else {
      const done = document.createElement('p');
      done.className = 'batch-download-done';
      done.textContent = 'Bagian terakhir sudah siap. Klik Unduh ZIP di atas untuk menyelesaikan ekspor.';
      container.appendChild(done);
    }
  }

  async function prepareFallbackBatchPart(session) {
    if (state.running || session.nextIndex >= session.parts.length) return;
    if (session.currentPart && !session.currentPart.downloaded) return;
    // Keep the previous Blob URL alive briefly so the browser can finish its download.
    // Its two-minute cleanup timer releases it after the download has started.
    session.currentPart = null;
    const index = session.nextIndex;
    const part = session.parts[index];
    state.running = true;
    validateReady();
    beginProgress(`Membuat ZIP bagian ${index + 1} dari ${session.parts.length}...`, session.totalFiles);
    updateProgress(session.progressState.done, session.totalFiles, `Menyiapkan bagian ${index + 1}/${session.parts.length}`);
    try {
      const built = await buildBatchZipPart(part, index, session.parts.length, session.progressState, session.ignoredRows);
      $('progressStatus').textContent = `Membuat ZIP bagian ${index + 1}...`;
      const blob = await built.zip.generateAsync(
        { type: 'blob', compression: 'STORE', streamFiles: true },
        meta => { $('progressStatus').textContent = `Membuat ZIP bagian ${index + 1}: ${Math.round(meta.percent || 0)}%`; }
      );
      session.stats.success += built.stats.success;
      session.stats.failed += built.stats.failed;
      session.stats.skipped += built.stats.skipped;
      session.stats.unreadable += built.stats.unreadable;
      const filename = batchPartFilename(session.baseFilename, index, session.parts.length);
      session.currentPart = { index, blob, size: blob.size, filename, stats: built.stats, url: URL.createObjectURL(blob), downloaded: false };
      session.nextIndex++;
      $('progressStatus').textContent = `ZIP bagian ${index + 1} siap diunduh`;
      const photoPercent = Math.min(95, Math.round(session.progressState.done / session.totalFiles * 95));
      $('progressPercent').textContent = `${photoPercent}%`;
      $('progressFill').style.width = `${photoPercent}%`;
      $('resultTitle').textContent = `${session.totalFiles} foto dibagi menjadi ${session.parts.length} ZIP.`;
      $('resultSummary').textContent = `${session.stats.success} foto berhasil diberi GPS pada bagian yang sudah dibuat. Setiap folder sumber utuh berada di satu ZIP; tidak ada folder yang terbagi ke beberapa arsip. Unduh bagian yang siap sebelum menyiapkan bagian berikutnya agar penggunaan memori tetap rendah.`;
      $('downloadAgain').classList.add('hidden');
      $('resultDetails').innerHTML = `<span><strong>${session.totalFiles}</strong> total foto</span><span><strong>${session.parts.length}</strong> file ZIP</span><span><strong>${formatBytes(BATCH_ZIP_TARGET_BYTES)}</strong> target per ZIP</span>`;
      renderBatchFallbackDownloads(session);
      $('resultCard').classList.remove('hidden');
    } catch (error) {
      alert(`Gagal membuat ZIP bagian ${index + 1}: ${error.message || error}`);
      $('progressStatus').textContent = `Gagal membuat bagian ${index + 1}`;
    } finally {
      state.running = false;
      validateReady();
    }
  }

  function batchDownloadFilename(outputRelative) {
    // Standard browser downloads cannot recreate nested folders. Prefix each
    // filename so files with the same basename from different folders stay distinct.
    return safeZipPath(outputRelative).split('/').join('__').replace(/[<>:"|?*\u0000-\u001F]/g, '_');
  }

  async function chooseBatchFolderDestination(session) {
    if (!window.isSecureContext || typeof window.showDirectoryPicker !== 'function') {
      alert('Penyimpanan langsung ke folder belum didukung browser ini. Tombol foto tetap bisa dipakai untuk mengunduh satu per satu melalui browser.');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      session.directoryHandle = handle;
      const button = $('batchChooseFolderButton');
      if (button) button.textContent = `Folder tujuan: ${handle.name}`;
      const note = $('batchFolderDestinationNote');
      if (note) note.textContent = 'Foto akan disimpan langsung ke folder tujuan dengan susunan subfolder tetap dipertahankan.';
    } catch (error) {
      if (!error || error.name !== 'AbortError') {
        console.warn('Folder destination selection failed.', error);
        alert(`Tidak dapat memilih folder tujuan: ${error.message || error}`);
      }
    }
  }

  async function writeBlobToDirectory(rootHandle, relativePath, blob) {
    const parts = safeZipPath(relativePath).split('/').filter(Boolean);
    if (!parts.length) throw new Error('Jalur file hasil tidak valid.');
    let directory = rootHandle;
    for (const part of parts.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(part, { create: true });
    }
    const fileHandle = await directory.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      try { await writable.abort(error); } catch (_) { /* preserve original error */ }
      throw error;
    }
  }

  function downloadBatchPhotoBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // The browser resolves the object URL after the click; a short lifetime
    // avoids retaining dozens of full-size photo Blobs during manual downloads.
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function createBatchPhotoOutput(item) {
    const { file } = item.entry;
    const coord = item.coord;
    if (!coord || !coord.valid) {
      return {
        blob: file,
        status: 'TANPA GPS',
        message: coord?.reason || 'Koordinat untuk folder ini kosong; file asli disalin tanpa perubahan.'
      };
    }

    let sourceReadable = false;
    try {
      const originalBytes = new Uint8Array(await file.arrayBuffer());
      sourceReadable = true;
      const tagged = writeExifGps(originalBytes, coord.lat, coord.lon);
      return {
        blob: new Blob([tagged], { type: 'image/jpeg' }),
        status: 'BERHASIL',
        message: `GPS ${coord.lat.toFixed(6)}, ${coord.lon.toFixed(6)} berhasil ditambahkan.`
      };
    } catch (error) {
      if (sourceReadable) {
        return {
          blob: file,
          status: 'GAGAL',
          message: `Penulisan GPS gagal; file asli tetap tersedia. ${error.message || error}`
        };
      }
      return {
        blob: null,
        status: 'GAGAL BACA',
        message: `File tidak dapat dibaca. ${error.message || error}`
      };
    }
  }

  function buildFolderModeReport(session) {
    const rows = [['nomor_folder','nama_file','status','latitude','longitude','ukuran_asli','pesan']];
    for (const item of session.items) {
      const status = item.status || 'BELUM DIUNDUH';
      const coord = item.coord;
      rows.push([
        item.folderNo,
        item.outputRelative,
        status,
        coord?.valid ? coord.lat.toFixed(6) : (coord?.rawLat || ''),
        coord?.valid ? coord.lon.toFixed(6) : (coord?.rawLon || ''),
        item.entry.file.size,
        item.message || (status === 'BELUM DIUNDUH' ? 'Foto belum diproses; proses hanya berjalan saat tombol unduh ditekan.' : '')
      ]);
    }
    if (session.ignoredRows.length) rows.push(...session.ignoredRows);
    rows.push([]);
    rows.push(['Ringkasan','','','','','',`Total foto: ${session.items.length}; berhasil: ${session.items.filter(x => x.status === 'BERHASIL').length}; tanpa GPS: ${session.items.filter(x => x.status === 'TANPA GPS').length}; gagal: ${session.items.filter(x => x.status === 'GAGAL' || x.status === 'GAGAL BACA' || x.status === 'GAGAL SIMPAN').length}`]);
    rows.push(['Catatan','','','','','','Mode Folder memproses setiap foto saat tombol unduh ditekan. File belum diproses tidak disimpan di memori sebagai Blob hasil.']);
    return csvText(rows);
  }

  function downloadBatchFolderReport(session) {
    const blob = new Blob([buildFolderModeReport(session)], { type: 'text/csv;charset=utf-8' });
    downloadBatchPhotoBlob(blob, 'laporan_batch_geotag_folder.csv');
  }

  function renderBatchFolderOutput(session) {
    const container = $('batchPartDownloads');
    container.innerHTML = '';
    container.classList.remove('hidden');

    const intro = document.createElement('p');
    intro.className = 'batch-download-intro';
    intro.textContent = `Daftar berisi ${session.items.length} foto dalam ${session.groups.length} folder. Foto baru dibaca dan diberi GPS ketika tombol pada baris foto ditekan; hasil foto tidak ditumpuk di RAM.`;
    container.appendChild(intro);

    if (window.isSecureContext && typeof window.showDirectoryPicker === 'function') {
      const destinationRow = document.createElement('div');
      destinationRow.className = 'batch-folder-destination';
      const destinationButton = document.createElement('button');
      destinationButton.type = 'button';
      destinationButton.className = 'batch-directory-button';
      destinationButton.id = 'batchChooseFolderButton';
      destinationButton.textContent = 'Pilih folder tujuan (opsional)';
      destinationButton.addEventListener('click', () => chooseBatchFolderDestination(session));
      const destinationNote = document.createElement('p');
      destinationNote.id = 'batchFolderDestinationNote';
      destinationNote.className = 'batch-folder-destination-note';
      destinationNote.textContent = 'Pilih folder agar foto tersimpan langsung ke disk dengan struktur folder sumber tetap utuh. Tanpa memilihnya, foto diunduh satu per satu melalui browser.';
      destinationRow.append(destinationButton, destinationNote);
      container.appendChild(destinationRow);
    }

    const reportButton = document.createElement('button');
    reportButton.type = 'button';
    reportButton.className = 'batch-report-button';
    reportButton.textContent = 'Unduh laporan CSV';
    reportButton.addEventListener('click', () => downloadBatchFolderReport(session));
    container.appendChild(reportButton);

    const list = document.createElement('div');
    list.className = 'batch-folder-list';
    for (const group of session.groups) {
      const section = document.createElement('section');
      section.className = 'batch-output-folder';
      const heading = document.createElement('div');
      heading.className = 'batch-output-folder-heading';
      const folderName = document.createElement('strong');
      folderName.textContent = group.outputFolder;
      const folderMeta = document.createElement('span');
      folderMeta.textContent = `${group.items.length} foto · ${group.coord?.valid ? 'GPS siap' : 'tanpa koordinat valid'}`;
      heading.append(folderName, folderMeta);
      const files = document.createElement('div');
      files.className = 'batch-output-files';

      for (const item of group.items) {
        const row = document.createElement('div');
        row.className = 'batch-output-file';
        const copy = document.createElement('div');
        copy.className = 'batch-output-file-copy';
        const name = document.createElement('strong');
        name.textContent = item.displayPath;
        const detail = document.createElement('span');
        detail.textContent = `${formatBytes(item.entry.file.size)} · Menunggu diproses`;
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'batch-photo-download-button';
        action.dataset.completed = 'false';
        action.textContent = item.coord?.valid ? 'Unduh foto' : 'Unduh asli';
        action.addEventListener('click', () => downloadBatchFolderItem(session, item, action, detail));
        copy.append(name, detail);
        row.append(copy, action);
        files.appendChild(row);
      }
      section.append(heading, files);
      list.appendChild(section);
    }
    container.appendChild(list);

    const total = document.createElement('p');
    total.className = 'batch-download-status';
    total.id = 'batchFolderOutputStatus';
    total.textContent = 'Belum ada foto yang diproses.';
    container.appendChild(total);
  }

  async function downloadBatchFolderItem(session, item, button, detail) {
    if (session.busy || item.busy || item.completed) return;
    session.busy = true;
    item.busy = true;
    state.running = true;
    validateReady();
    const photoButtons = Array.from($('batchPartDownloads').querySelectorAll('.batch-photo-download-button'));
    photoButtons.forEach(photoButton => { photoButton.disabled = true; });
    button.textContent = 'Memproses...';
    detail.textContent = `${formatBytes(item.entry.file.size)} · Membaca dan menulis GPS...`;

    try {
      const output = await createBatchPhotoOutput(item);
      item.status = output.status;
      item.message = output.message;
      if (!output.blob) {
        item.completed = true;
        button.dataset.completed = 'true';
        button.textContent = 'Gagal dibaca';
        detail.textContent = output.message;
        button.classList.add('is-failed');
      } else if (session.directoryHandle) {
        await writeBlobToDirectory(session.directoryHandle, item.outputRelative, output.blob);
        item.completed = true;
        button.dataset.completed = 'true';
        button.textContent = 'Tersimpan';
        detail.textContent = `${formatBytes(output.blob.size)} · ${output.status} · Tersimpan ke folder tujuan`;
      } else {
        downloadBatchPhotoBlob(output.blob, batchDownloadFilename(item.outputRelative));
        item.completed = true;
        button.dataset.completed = 'true';
        button.textContent = 'Terunduh';
        detail.textContent = `${formatBytes(output.blob.size)} · ${output.status} · ${output.message}`;
      }
    } catch (error) {
      item.status = 'GAGAL SIMPAN';
      item.message = `Tidak dapat menyimpan file: ${error.message || error}`;
      button.disabled = false;
      button.textContent = 'Coba lagi';
      button.classList.add('is-failed');
      detail.textContent = item.message;
    } finally {
      item.busy = false;
      session.busy = false;
      state.running = false;
      photoButtons.forEach(photoButton => { photoButton.disabled = photoButton.dataset.completed === 'true'; });
      validateReady();
      const completed = session.items.filter(entry => entry.completed).length;
      const success = session.items.filter(entry => entry.status === 'BERHASIL').length;
      const noGps = session.items.filter(entry => entry.status === 'TANPA GPS').length;
      const failed = session.items.filter(entry => entry.status === 'GAGAL' || entry.status === 'GAGAL BACA' || entry.status === 'GAGAL SIMPAN').length;
      const status = $('batchFolderOutputStatus');
      if (status) status.textContent = `${completed}/${session.items.length} foto selesai · ${success} GPS berhasil · ${noGps} tanpa GPS · ${failed} gagal`;
    }
  }

  function prepareBatchFolderOutput(eligibleGroups, ignoredRows, totalEligibleFiles) {
    const groups = [];
    const items = [];
    for (const folderNo of eligibleGroups) {
      const coord = state.batchCoordinates.get(folderNo);
      const entries = state.batchGroups.get(folderNo) || [];
      if (!entries.length) continue;
      const folderLabel = cleanFolderLabel(coord?.folderName) || cleanFolderLabel(entries[0]?.sourceFolderLabel);
      const outputFolder = folderLabel ? `${folderNo}. ${folderLabel}` : String(folderNo);
      const groupItems = entries.map(entry => {
        const outputRelative = batchOutputRelativePath(entry.relative, folderNo, folderLabel);
        const relativeSegments = safeZipPath(outputRelative).split('/');
        const item = {
          folderNo, entry, coord, outputRelative,
          displayPath: relativeSegments.slice(1).join('/') || entry.file.name,
          busy: false, completed: false, status: null, message: ''
        };
        items.push(item);
        return item;
      });
      groups.push({ folderNo, outputFolder, coord, items: groupItems });
    }

    const session = { groups, items, ignoredRows, totalFiles: totalEligibleFiles, directoryHandle: null };
    state.batchFolderOutputSession = session;
    $('progressCard').classList.add('hidden');
    $('resultTitle').textContent = 'Daftar foto siap diunduh.';
    $('resultSummary').textContent = 'Pilih foto yang ingin diunduh. Pemrosesan GPS dilakukan hanya untuk foto yang kamu pilih, satu per satu. Foto yang belum diunduh tidak diproses.';
    $('downloadAgain').classList.add('hidden');
    $('resultDetails').innerHTML = `<span><strong>${items.length}</strong> foto</span><span><strong>${groups.length}</strong> folder</span><span><strong>${ignoredRows.length}</strong> foto di luar jangkauan Excel</span>`;
    renderBatchFolderOutput(session);
    $('resultCard').classList.remove('hidden');
  }

  function beginProgress(title, total) {
    state.running = true;
    state.zipBlob = null;
    validateReady();
    $('resultCard').classList.add('hidden');
    $('progressCard').classList.remove('hidden');
    $('progressTitle').textContent = title;
    $('progressFill').style.width = '0%';
    $('progressPercent').textContent = '0%';
    $('progressCount').textContent = `0 dari ${total} foto`;
    $('progressStatus').textContent = 'Menyiapkan...';
    $('currentFile').textContent = '';
  }

  function finishResult(summary, success, failed, skipped, ignored, output, filename) {
    state.zipBlob = output.blob;
    state.zipFilename = filename;
    $('progressTitle').textContent = 'Proses selesai';
    $('progressStatus').textContent = output.savedDirectly ? 'ZIP berhasil disimpan' : 'ZIP berhasil dibuat';
    $('progressPercent').textContent = '100%';
    $('progressFill').style.width = '100%';
    $('resultTitle').textContent = output.savedDirectly ? 'ZIP berhasil disimpan.' : 'ZIP siap diunduh.';
    $('resultSummary').textContent = output.savedDirectly
      ? `${summary} ZIP sudah disimpan ke lokasi yang kamu pilih.`
      : `${summary} Klik tombol di bawah untuk mengunduh ZIP.`;
    $('downloadAgain').classList.toggle('hidden', !output.blob);
    $('resultDetails').innerHTML = `<span><strong>${success}</strong> berhasil</span><span><strong>${failed}</strong> gagal</span>${skipped ? `<span><strong>${skipped}</strong> tanpa GPS</span>` : ''}${ignored ? `<span><strong>${ignored}</strong> folder diabaikan</span>` : ''}<span><strong>${formatBytes(output.size)}</strong> ukuran ZIP</span>`;
    $('resultCard').classList.remove('hidden');
  }

  function csvText(rows) {
    return '\ufeff' + rows.map(row => row.map(value => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
  }

  async function processSinglePhotos() {
    if (state.running || !state.files.length) return;
    const coords = getCoordinates(true);
    if (!coords) return;
    if (typeof JSZip === 'undefined') { alert('Library ZIP tidak ditemukan. Pastikan folder lib dan file jszip.min.js tidak dipindahkan.'); return; }

    const filename = cleanZipName($('zipName').value, 'hasil_geotag_foto');
    const target = await prepareZipOutput(filename);
    if (target.cancelled) return;

    beginProgress('Memproses foto...', state.files.length);
    if (target.fileHandle) $('progressStatus').textContent = 'Menyiapkan penyimpanan ZIP langsung...';
    const zip = new JSZip();
    const report = [['nama_file','status','latitude','longitude','ukuran_asli','pesan']];
    let success = 0, failed = 0;
    for (let i = 0; i < state.files.length; i++) {
      const file = state.files[i];
      const relative = safeZipPath(file.webkitRelativePath || file.name);
      $('currentFile').textContent = relative;
      try {
        const input = new Uint8Array(await file.arrayBuffer());
        const tagged = writeExifGps(input, coords.lat, coords.lon);
        // Keep the transformed image as a Blob so JSZip can read it lazily
        // while generating the archive, rather than retaining every byte array.
        zip.file(relative, new Blob([tagged], { type: 'image/jpeg' }), { date: file.lastModified ? new Date(file.lastModified) : new Date() });
        success++;
        report.push([relative,'BERHASIL',coords.lat.toFixed(6),coords.lon.toFixed(6),file.size,'GPS EXIF berhasil ditambahkan']);
      } catch (error) {
        failed++;
        zip.file(relative, file, { date: file.lastModified ? new Date(file.lastModified) : new Date() });
        report.push([relative,'GAGAL',coords.lat.toFixed(6),coords.lon.toFixed(6),file.size,String(error && error.message ? error.message : error)]);
      }
      updateProgress(i + 1, state.files.length, relative);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    report.push([]); report.push(['Ringkasan','','','','',`Foto berhasil: ${success}; gagal: ${failed}`]);
    zip.file('laporan_geotag.csv', csvText(report));
    $('progressStatus').textContent = target.fileHandle ? 'Menyimpan file ZIP...' : 'Membuat file ZIP...';
    $('currentFile').textContent = 'Mengemas foto dan laporan...';
    try {
      const output = await exportZip(zip, filename, target);
      const summary = failed === 0
        ? `${success} foto berhasil diberi metadata GPS.`
        : `${success} foto berhasil diberi GPS, ${failed} foto tidak dapat diubah dan tetap disertakan sebagai file asli dalam ZIP.`;
      finishResult(summary, success, failed, 0, 0, output, filename);
      $('progressCount').textContent = `${success} berhasil · ${failed} gagal`;
    } catch (error) {
      alert('Gagal menyimpan ZIP: ' + (error.message || error));
      $('progressStatus').textContent = 'Gagal menyimpan ZIP';
    } finally {
      state.running = false; validateReady();
    }
  }

  function xmlDocument(source, label) {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error(`Format ${label} di dalam Excel tidak dapat dibaca.`);
    return doc;
  }

  function localElements(parent, localName) {
    return Array.from(parent.getElementsByTagName('*')).filter(node => node.localName === localName);
  }

  function normalizeZipPath(path) {
    const stack = [];
    for (const part of String(path).replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') stack.pop(); else stack.push(part);
    }
    return stack.join('/');
  }

  async function readXlsxCoordinates(file) {
    if (typeof JSZip === 'undefined') throw new Error('Library ZIP tidak ditemukan. Periksa folder lib.');
    const workbookZip = await JSZip.loadAsync(await file.arrayBuffer());
    const workbookEntry = workbookZip.file('xl/workbook.xml');
    if (!workbookEntry) throw new Error('File ini bukan workbook Excel .xlsx yang valid.');
    const workbookDoc = xmlDocument(await workbookEntry.async('text'), 'workbook');
    const sheetNode = localElements(workbookDoc, 'sheet')[0];
    if (!sheetNode) throw new Error('Sheet pertama tidak ditemukan di file Excel.');
    const relId = sheetNode.getAttribute('r:id') || sheetNode.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const relsEntry = workbookZip.file('xl/_rels/workbook.xml.rels');
    let sheetPath = 'xl/worksheets/sheet1.xml';
    if (relsEntry && relId) {
      const relsDoc = xmlDocument(await relsEntry.async('text'), 'relasi workbook');
      const rel = localElements(relsDoc, 'Relationship').find(item => item.getAttribute('Id') === relId);
      if (rel && rel.getAttribute('Target')) {
        const target = rel.getAttribute('Target');
        sheetPath = normalizeZipPath(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
      }
    }
    const sheetEntry = workbookZip.file(sheetPath);
    if (!sheetEntry) throw new Error('Isi sheet Excel tidak ditemukan. Pastikan menggunakan template .xlsx biasa.');

    let sharedStrings = [];
    const sharedEntry = workbookZip.file('xl/sharedStrings.xml');
    if (sharedEntry) {
      const sharedDoc = xmlDocument(await sharedEntry.async('text'), 'shared strings');
      sharedStrings = localElements(sharedDoc, 'si').map(si => localElements(si, 't').map(t => t.textContent || '').join(''));
    }
    const sheetDoc = xmlDocument(await sheetEntry.async('text'), 'sheet');
    const rawRows = new Map();
    let maxFolder = 0;
    let folderNameColumnEnabled = true;
    for (const cell of localElements(sheetDoc, 'c')) {
      const ref = cell.getAttribute('r') || '';
      const match = /^([A-Z]+)(\d+)$/i.exec(ref);
      if (!match) continue;
      const column = match[1].toUpperCase();
      if (column !== 'B' && column !== 'C' && column !== 'D') continue;
      const row = Number(match[2]);
      if (!Number.isSafeInteger(row) || row < 1) continue;
      let value = '';
      const type = cell.getAttribute('t') || '';
      if (type === 'inlineStr') {
        value = localElements(cell, 't').map(t => t.textContent || '').join('');
      } else {
        const v = localElements(cell, 'v')[0];
        if (v) {
          value = v.textContent || '';
          if (type === 's') value = sharedStrings[Number(value)] ?? '';
        }
      }
      value = String(value).trim();
      if (row === 1) {
        if (column === 'D' && /PETUNJUK|INSTRUKSI/i.test(value)) folderNameColumnEnabled = false;
        continue;
      }
      if (!rawRows.has(row)) rawRows.set(row, { lat: '', lon: '', folderName: '' });
      if (column === 'B') rawRows.get(row).lat = value;
      if (column === 'C') rawRows.get(row).lon = value;
      if (column === 'D' && folderNameColumnEnabled) rawRows.get(row).folderName = value;
      if ((column === 'B' || column === 'C') && value !== '') maxFolder = Math.max(maxFolder, row - 1);
    }
    if (maxFolder < 1) throw new Error('Belum ada koordinat di Excel. Isi Latitude kolom B dan Longitude kolom C mulai baris 2.');

    const coordinates = new Map();
    for (const [row, raw] of rawRows.entries()) {
      if (raw.lat === '' && raw.lon === '' && raw.folderName === '') continue;
      const folderNo = row - 1;
      const lat = parseCoordinate(raw.lat, -90, 90);
      const lon = parseCoordinate(raw.lon, -180, 180);
      const repairLat = lat === null ? decimalRestorationCandidates(raw.lat, -90, 90, 'lat') : [];
      const repairLon = lon === null ? decimalRestorationCandidates(raw.lon, -180, 180, 'lon') : [];
      const valid = lat !== null && lon !== null;
      const repairable = repairLat.length > 0 || repairLon.length > 0;
      let reason = '';
      if (!valid) {
        if (raw.lat === '' || raw.lon === '') reason = 'Latitude atau longitude belum diisi';
        else if (repairable) reason = 'Titik desimal kemungkinan dihapus atau dianggap sebagai pemisah ribuan oleh Excel. Periksa opsi pemulihan.';
        else reason = 'Koordinat tidak valid. Gunakan titik (.) sebagai pemisah desimal dan pastikan nilainya dalam rentang GPS.';
      }
      coordinates.set(folderNo, { valid, lat, lon, rawLat: raw.lat, rawLon: raw.lon, folderName: cleanFolderLabel(raw.folderName), reason, repairLat, repairLon, repairable, recovered: false });
    }
    return { coordinates, maxFolder, sheetName: sheetNode.getAttribute('name') || 'Sheet1' };
  }

  function parseCoordinate(value, min, max) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (!text || text.includes(',')) return null;
    // Decimal coordinates are deliberately strict: use a dot, never a comma.
    // This also works with text-formatted Excel cells on comma-decimal locales.
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
    const number = Number(text);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  }

  function collapsedCoordinateDigits(value) {
    const text = String(value ?? '').trim();
    if (!text || text.includes(',')) return null;
    const match = /^([+-]?)(.*)$/.exec(text);
    const sign = match[1];
    const body = match[2];
    let digits = '';
    if (/^\d+$/.test(body)) digits = body;
    else if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(body)) digits = body.replace(/\./g, '');
    else return null;
    if (digits.length < 4) return null;
    return { sign, digits };
  }

  function decimalRestorationCandidates(value, min, max, axis) {
    const collapsed = collapsedCoordinateDigits(value);
    if (!collapsed) return [];
    const positions = axis === 'lat' ? [1, 2] : [1, 2, 3];
    return positions.filter(position => position < collapsed.digits.length).map(position => {
      const candidateText = `${collapsed.sign}${collapsed.digits.slice(0, position)}.${collapsed.digits.slice(position)}`;
      const numericValue = parseCoordinate(candidateText, min, max);
      return numericValue === null ? null : { position, text: candidateText, value: numericValue };
    }).filter(Boolean);
  }

  function selectedRestoration(coord, axis, position) {
    const choices = axis === 'lat' ? coord.repairLat : coord.repairLon;
    if (choices && choices.length) return choices.find(item => item.position === Number(position)) || null;
    const existing = axis === 'lat' ? coord.lat : coord.lon;
    if (existing !== null && existing !== undefined) return { value: existing, text: Number(existing).toFixed(8) };
    return null;
  }

  function groupBatchFiles(fileList) {
    const groups = new Map();
    let unsorted = 0, photoCount = 0, rootName = '';
    for (const file of Array.from(fileList || [])) {
      if (!accepted.test(file.name)) continue;
      photoCount++;
      const path = String(file.webkitRelativePath || '').replace(/\\/g, '/');
      const segments = path.split('/').filter(Boolean);
      const folderMatch = segments.length >= 3 ? /^(\d+)(?:[.\s_-]+(.+))?$/.exec(segments[1]) : null;
      if (!folderMatch) { unsorted++; continue; }
      const folderNo = Number(folderMatch[1]);
      if (!Number.isSafeInteger(folderNo) || folderNo < 1) { unsorted++; continue; }
      if (!rootName) rootName = segments[0];
      if (!groups.has(folderNo)) groups.set(folderNo, []);
      groups.get(folderNo).push({ file, relative: safeZipPath(segments.slice(1).join('/')), sourceFolderLabel: cleanFolderLabel(folderMatch[2] || '') });
    }
    for (const files of groups.values()) files.sort((a,b) => a.relative.localeCompare(b.relative));
    return { groups, rootName, unsorted, photoCount };
  }

  function addStat(container, value, label) {
    const stat = document.createElement('div'); stat.className = 'batch-stat';
    const number = document.createElement('strong'); number.textContent = String(value);
    const caption = document.createElement('span'); caption.textContent = label;
    stat.append(number, caption); container.append(stat);
  }

  function updateCoordinateRecovery() {
    const panel = $('coordinateRecovery');
    if (!panel) return;
    const affected = Array.from(state.batchCoordinates.entries())
      .filter(([, coord]) => coord.repairable)
      .sort((a, b) => a[0] - b[0]);
    if (!affected.length) {
      panel.classList.add('hidden');
      $('recoveryConfirmWrap').classList.add('hidden');
      $('recoveryPreview').innerHTML = '';
      return;
    }

    panel.classList.remove('hidden');
    const latPosition = Number($('recoveryLatDigits').value || 1);
    const lonPosition = Number($('recoveryLonDigits').value || 3);
    const preview = $('recoveryPreview');
    preview.innerHTML = '';
    let allRestorable = true;
    const shown = affected.slice(0, 40);
    for (const [folderNo, coord] of shown) {
      const latChoice = selectedRestoration(coord, 'lat', latPosition);
      const lonChoice = selectedRestoration(coord, 'lon', lonPosition);
      if (!latChoice || !lonChoice) allRestorable = false;
      const row = document.createElement('div');
      row.className = 'recovery-preview-row';
      const folder = document.createElement('strong'); folder.textContent = String(folderNo);
      const latCell = document.createElement('div');
      const latLabel = document.createElement('span'); latLabel.textContent = 'LAT '; 
      const latValue = document.createElement('code');
      latValue.textContent = coord.repairLat?.length ? `${coord.rawLat || 'kosong'} → ${latChoice ? latChoice.text : 'tidak cocok dengan posisi titik'}` : (latChoice?.text || coord.rawLat || 'kosong');
      if (coord.repairLat?.length) latValue.className = 'recovery-raw';
      latCell.append(latLabel, latValue);
      const lonCell = document.createElement('div');
      const lonLabel = document.createElement('span'); lonLabel.textContent = 'LON ';
      const lonValue = document.createElement('code');
      lonValue.textContent = coord.repairLon?.length ? `${coord.rawLon || 'kosong'} → ${lonChoice ? lonChoice.text : 'tidak cocok dengan posisi titik'}` : (lonChoice?.text || coord.rawLon || 'kosong');
      if (coord.repairLon?.length) lonValue.className = 'recovery-raw';
      lonCell.append(lonLabel, lonValue);
      row.append(folder, latCell, lonCell);
      preview.append(row);
    }
    if (affected.length > shown.length) {
      const more = document.createElement('div');
      more.className = 'recovery-preview-row';
      more.textContent = `${affected.length - shown.length} baris lainnya tidak ditampilkan di pratinjau.`;
      preview.append(more);
    }
    $('applyCoordinateRecovery').disabled = !allRestorable;
    $('applyCoordinateRecovery').textContent = state.batchRecoveryApplied ? 'Terapkan ulang susunan titik desimal' : 'Terapkan susunan titik desimal ini';
    $('recoveryConfirmWrap').classList.toggle('hidden', !state.batchRecoveryApplied);
    $('recoveryConfirm').checked = state.batchRecoveryConfirmed;
  }

  function resetAppliedRecovery() {
    state.batchRecoveryApplied = false;
    state.batchRecoveryConfirmed = false;
    $('recoveryConfirm').checked = false;
    for (const [folderNo, coord] of state.batchCoordinates.entries()) {
      if (!coord.recovered) continue;
      const lat = parseCoordinate(coord.rawLat, -90, 90);
      const lon = parseCoordinate(coord.rawLon, -180, 180);
      state.batchCoordinates.set(folderNo, { ...coord, valid: lat !== null && lon !== null, lat, lon, recovered: false, recoveredLatText: '', recoveredLonText: '' });
    }
  }

  function applyCoordinateRecovery() {
    const latPosition = Number($('recoveryLatDigits').value || 1);
    const lonPosition = Number($('recoveryLonDigits').value || 3);
    let recovered = 0;
    let unresolved = 0;
    for (const [folderNo, coord] of state.batchCoordinates.entries()) {
      if (!coord.repairable) continue;
      const latChoice = selectedRestoration(coord, 'lat', latPosition);
      const lonChoice = selectedRestoration(coord, 'lon', lonPosition);
      if (!latChoice || !lonChoice) {
        unresolved++;
        state.batchCoordinates.set(folderNo, { ...coord, valid: false, recovered: false, reason: 'Posisi titik desimal yang dipilih tidak menghasilkan pasangan koordinat valid.' });
        continue;
      }
      const lat = parseCoordinate(latChoice.text, -90, 90);
      const lon = parseCoordinate(lonChoice.text, -180, 180);
      if (lat === null || lon === null) {
        unresolved++;
        state.batchCoordinates.set(folderNo, { ...coord, valid: false, recovered: false, reason: 'Hasil pemulihan berada di luar rentang koordinat GPS.' });
        continue;
      }
      state.batchCoordinates.set(folderNo, {
        ...coord, valid: true, lat, lon, recovered: true,
        recoveredLatText: latChoice.text, recoveredLonText: lonChoice.text,
        recoveryLatPosition: latPosition, recoveryLonPosition: lonPosition,
        reason: 'Titik desimal disusun kembali dari angka Excel. Perlu persetujuan pengguna.'
      });
      recovered++;
    }
    state.batchRecoveryApplied = recovered > 0;
    state.batchRecoveryConfirmed = false;
    $('recoveryConfirm').checked = false;
    if (!recovered) {
      alert('Tidak ada pasangan koordinat yang dapat dipulihkan dengan posisi titik yang dipilih. Coba ubah jumlah digit sebelum titik atau periksa kembali file Excel.');
    } else if (unresolved) {
      alert(`${recovered} pasangan koordinat berhasil disusun kembali. ${unresolved} pasangan belum dapat dipulihkan. Periksa semua baris sebelum menyetujui.`);
    }
    updateBatchPreview();
  }

  function updateBatchPreview() {
    const summary = $('batchSummary');
    const wrap = $('batchMappingWrap');
    updateCoordinateRecovery();
    if (!state.batchExcelName && !state.batchGroups.size) {
      summary.classList.add('hidden'); wrap.classList.add('hidden'); validateReady(); return;
    }
    summary.innerHTML = '';
    const validCoords = Array.from(state.batchCoordinates.values()).filter(item => item.valid).length;
    const foldersWithin = Array.from(state.batchGroups.keys()).filter(n => n <= state.batchMaxFolder).length;
    const photoWithin = Array.from(state.batchGroups.entries()).filter(([n]) => n <= state.batchMaxFolder).reduce((sum, [, files]) => sum + files.length, 0);
    addStat(summary, validCoords, 'Koordinat valid di Excel');
    addStat(summary, state.batchGroups.size, 'Folder bernomor ditemukan');
    addStat(summary, photoWithin, 'Foto dalam jangkauan Excel');
    summary.classList.remove('hidden');

    const body = $('mappingBody'); body.innerHTML = '';
    const folderNumbers = Array.from(state.batchGroups.keys()).sort((a,b) => a-b);
    for (const folderNo of folderNumbers.slice(0, 80)) {
      const files = state.batchGroups.get(folderNo) || [];
      const coord = state.batchCoordinates.get(folderNo);
      const outOfRange = folderNo > state.batchMaxFolder;
      let status = 'Siap', statusClass = '';
      if (outOfRange) { status = 'Diabaikan'; statusClass = 'muted'; }
      else if (coord?.recovered) { status = state.batchRecoveryConfirmed ? 'Pulih & disetujui' : 'Periksa hasil'; statusClass = state.batchRecoveryConfirmed ? 'recovered' : 'warn'; }
      else if (!coord || !coord.valid) { status = coord?.repairable ? 'Desimal hilang' : 'Lewati'; statusClass = 'warn'; }
      const row = document.createElement('tr');
      const sourceLabel = cleanFolderLabel(coord?.folderName) || cleanFolderLabel(files[0]?.sourceFolderLabel);
      const outputFolderLabel = sourceLabel ? `${folderNo}. ${sourceLabel}` : String(folderNo);
      const values = [outputFolderLabel, coord?.valid ? (coord.recovered ? coord.recoveredLatText : coord.lat.toFixed(6)) : (coord?.rawLat || '—'), coord?.valid ? (coord.recovered ? coord.recoveredLonText : coord.lon.toFixed(6)) : (coord?.rawLon || '—'), String(files.length)];
      for (const value of values) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
      const statusCell = document.createElement('td'); const badge = document.createElement('span'); badge.className = `mapping-status ${statusClass}`; badge.textContent = status; statusCell.append(badge); row.append(statusCell);
      body.append(row);
    }
    const hiddenRows = Math.max(0, folderNumbers.length - 80);
    $('mappingCount').textContent = `${folderNumbers.length} folder${hiddenRows ? ` · ${hiddenRows} lainnya tidak ditampilkan` : ''}`;
    wrap.classList.toggle('hidden', folderNumbers.length === 0);
    const footnote = wrap.querySelector('.mapping-footnote');
    if (footnote) footnote.textContent = `Nomor folder acuan terakhir: ${state.batchMaxFolder || 0}. ${state.batchUnsortedCount ? `${state.batchUnsortedCount} foto di luar folder bernomor tidak akan diproses. ` : ''}Folder di atas nomor acuan akan diabaikan. Koordinat kosong atau tidak valid akan disalin tanpa GPS dan dicatat di laporan.`;
    validateReady();
  }

  async function handleExcelSelection(file) {
    state.batchExcelName = file ? file.name : '';
    state.batchCoordinates = new Map(); state.batchMaxFolder = 0; state.batchExcelError = '';
    state.batchRecoveryApplied = false; state.batchRecoveryConfirmed = false;
    if ($('recoveryConfirm')) $('recoveryConfirm').checked = false;
    state.zipBlob = null;
    $('resultCard').classList.add('hidden');
    if (!file) { $('excelTitle').textContent = 'Pilih file Excel'; $('excelHint').textContent = 'Gunakan template koordinat GeoTag Studio'; updateBatchPreview(); return; }
    $('excelTitle').textContent = file.name;
    $('excelHint').classList.remove('batch-error');
    $('excelHint').textContent = 'Sedang membaca koordinat...';
    state.batchExcelLoading = true; updateBatchPreview();
    try {
      const parsed = await readXlsxCoordinates(file);
      state.batchCoordinates = parsed.coordinates;
      state.batchMaxFolder = parsed.maxFolder;
      $('excelHint').classList.remove('batch-error');
      $('excelHint').textContent = `${parsed.coordinates.size} baris berisi data · nomor folder terakhir ${parsed.maxFolder}`;
    } catch (error) {
      state.batchExcelError = error.message || String(error);
      $('excelHint').textContent = state.batchExcelError;
      $('excelHint').classList.add('batch-error');
      alert('Excel tidak dapat digunakan: ' + state.batchExcelError);
    } finally {
      state.batchExcelLoading = false;
      updateBatchPreview();
    }
  }

  function handleBatchFolderSelection(files) {
    const parsed = groupBatchFiles(files);
    state.batchGroups = parsed.groups;
    state.batchFolderLabel = parsed.rootName || 'Folder dipilih';
    state.batchPhotoCount = parsed.photoCount;
    state.batchUnsortedCount = parsed.unsorted;
    state.zipBlob = null;
    resetBatchPartDownloads();
    $('resultCard').classList.add('hidden');
    $('batchFolderTitle').textContent = parsed.rootName ? `Folder utama: ${parsed.rootName}` : 'Folder utama belum berisi subfolder angka';
    const folderCount = parsed.groups.size;
    $('batchFolderHint').textContent = `${parsed.photoCount} foto JPG/JPEG ditemukan · ${folderCount} subfolder angka${parsed.unsorted ? ` · ${parsed.unsorted} foto di luar subfolder angka diabaikan` : ''}`;
    updateBatchPreview();
  }

  async function processBatchPhotos() {
    if (state.running) return;
    const unresolvedRecovery = Array.from(state.batchGroups.keys()).some(folderNo => {
      if (folderNo > state.batchMaxFolder) return false;
      const coord = state.batchCoordinates.get(folderNo);
      return !!(coord && (coord.repairLat?.length || coord.repairLon?.length) && (!coord.recovered || !state.batchRecoveryConfirmed));
    });
    if (unresolvedRecovery) { alert('Ada koordinat yang kemungkinan kehilangan titik desimal. Pulihkan, periksa hasilnya, lalu centang persetujuan sebelum memproses.'); return; }
    const matchedFolderNumbers = Array.from(state.batchGroups.keys()).filter(n => n <= state.batchMaxFolder && state.batchCoordinates.get(n)?.valid);
    if (!matchedFolderNumbers.length) { alert('Belum ada folder yang cocok dengan koordinat valid di Excel.'); return; }
    const outputMode = getBatchOutputMode();
    if (outputMode === 'zip' && typeof JSZip === 'undefined') { alert('Library ZIP tidak ditemukan. Pastikan folder lib tidak dipindahkan.'); return; }

    const folders = Array.from(state.batchGroups.keys()).sort((a,b) => a-b);
    const eligibleGroups = folders.filter(n => n <= state.batchMaxFolder);
    const totalEligibleFiles = eligibleGroups.reduce((sum, n) => sum + state.batchGroups.get(n).length, 0);
    if (!totalEligibleFiles) { alert('Tidak ada foto yang berada dalam jangkauan nomor koordinat Excel.'); return; }

    if (outputMode === 'folder') {
      const ignoredFolders = folders.filter(n => n > state.batchMaxFolder);
      const ignoredRows = [];
      for (const folderNo of ignoredFolders) {
        for (const entry of (state.batchGroups.get(folderNo) || [])) {
          ignoredRows.push([folderNo, entry.relative, 'DIABAIKAN', '', '', entry.file.size, `Nomor folder melebihi nomor koordinat terakhir di Excel (${state.batchMaxFolder})`]);
        }
      }
      resetBatchPartDownloads();
      prepareBatchFolderOutput(eligibleGroups, ignoredRows, totalEligibleFiles);
      return;
    }

    const parts = splitBatchIntoParts(eligibleGroups);
    if (!parts.length) { alert('Tidak ada foto yang bisa dimasukkan ke ZIP.'); return; }
    const baseFilename = cleanZipName($('batchZipName').value, 'hasil_geotag_batch');
    const target = await chooseBatchOutputDirectory();
    if (target.cancelled) return;

    const ignoredFolders = folders.filter(n => n > state.batchMaxFolder);
    const ignoredRows = [];
    for (const folderNo of ignoredFolders) {
      for (const entry of (state.batchGroups.get(folderNo) || [])) {
        ignoredRows.push([folderNo, entry.relative, 'DIABAIKAN', '', '', entry.file.size, `Nomor folder melebihi nomor koordinat terakhir di Excel (${state.batchMaxFolder})`]);
      }
    }
    const progressState = { done: 0, total: totalEligibleFiles };
    const summaryStats = { success: 0, failed: 0, skipped: 0, unreadable: 0 };
    resetBatchPartDownloads();

    if (target.directoryHandle) {
      beginProgress(`Membagi ${totalEligibleFiles} foto menjadi ${parts.length} ZIP tanpa memecah folder...`, totalEligibleFiles);
      state.running = true;
      validateReady();
      const savedNames = [];
      try {
        for (let index = 0; index < parts.length; index++) {
          $('progressStatus').textContent = `Memproses bagian ${index + 1} dari ${parts.length}...`;
          const built = await buildBatchZipPart(parts[index], index, parts.length, progressState, ignoredRows);
          summaryStats.success += built.stats.success;
          summaryStats.failed += built.stats.failed;
          summaryStats.skipped += built.stats.skipped;
          summaryStats.unreadable += built.stats.unreadable;
          const filename = batchPartFilename(baseFilename, index, parts.length);
          $('progressStatus').textContent = `Menyimpan ZIP ${index + 1} dari ${parts.length}...`;
          $('currentFile').textContent = filename;
          const size = await saveZipToDirectory(built.zip, filename, target.directoryHandle);
          savedNames.push(`${filename} (${formatBytes(size)})`);
        }
        $('progressTitle').textContent = 'Semua bagian berhasil disimpan';
        $('progressPercent').textContent = '100%';
        $('progressFill').style.width = '100%';
        $('progressStatus').textContent = `${parts.length} ZIP tersimpan ke folder pilihan`;
        $('currentFile').textContent = '';
        $('resultTitle').textContent = `${totalEligibleFiles} foto selesai diproses.`;
        $('resultSummary').textContent = `${parts.length} ZIP terpisah sudah disimpan ke folder yang kamu pilih. Setiap folder bernomor utuh berada hanya di satu ZIP, jadi tidak ada folder yang terduplikasi antarbagian. Ekstrak semua ZIP ke folder tujuan yang sama untuk mengembalikan struktur foto bernomor.`;
        $('downloadAgain').classList.add('hidden');
        $('resultDetails').innerHTML = `<span><strong>${summaryStats.success}</strong> GPS berhasil</span><span><strong>${summaryStats.failed}</strong> gagal</span><span><strong>${parts.length}</strong> ZIP tersimpan</span><span><strong>${formatBytes(parts.reduce((sum, part) => sum + part.bytes, 0))}</strong> foto sumber</span>`;
        const container = $('batchPartDownloads');
        container.innerHTML = '';
        container.classList.remove('hidden');
        const heading = document.createElement('p');
        heading.className = 'batch-download-intro';
        heading.textContent = 'File yang tersimpan:';
        const list = document.createElement('ul');
        list.className = 'batch-saved-list';
        savedNames.forEach(name => { const li = document.createElement('li'); li.textContent = name; list.appendChild(li); });
        container.append(heading, list);
        $('resultCard').classList.remove('hidden');
      } catch (error) {
        alert(`Ekspor terhenti. ${savedNames.length} ZIP sudah tersimpan; gagal saat membuat bagian berikutnya. Detail: ${error.message || error}`);
        $('progressStatus').textContent = `Ekspor terhenti setelah ${savedNames.length} dari ${parts.length} ZIP`;
      } finally {
        state.running = false;
        validateReady();
      }
      return;
    }

    const session = {
      parts, baseFilename, totalFiles: totalEligibleFiles, progressState,
      nextIndex: 0, currentPart: null, downloaded: new Set(),
      ignoredRows, stats: summaryStats
    };
    state.batchExportSession = session;
    await prepareFallbackBatchPart(session);
  }

  folderInput.addEventListener('change', () => {
    const files = Array.from(folderInput.files || []);
    const folder = files[0]?.webkitRelativePath?.split('/')[0] || 'Foto terpilih';
    showFiles(files, folder);
  });
  $('changeFolder').addEventListener('click', () => { folderInput.value = ''; folderInput.click(); });
  latInput.addEventListener('input', updateCoordinatePreview);
  lonInput.addEventListener('input', updateCoordinatePreview);
  processButton.addEventListener('click', processSinglePhotos);
  batchProcessButton.addEventListener('click', processBatchPhotos);
  document.querySelectorAll('.mode-tab').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $('excelInput').addEventListener('change', () => handleExcelSelection($('excelInput').files?.[0] || null));
  $('batchFolderInput').addEventListener('change', () => handleBatchFolderSelection($('batchFolderInput').files || []));
  document.querySelectorAll('input[name="batchOutputMode"]').forEach(input => input.addEventListener('change', updateBatchOutputMode));
  $('recoveryLatDigits').addEventListener('change', () => { resetAppliedRecovery(); updateBatchPreview(); });
  $('recoveryLonDigits').addEventListener('change', () => { resetAppliedRecovery(); updateBatchPreview(); });
  $('applyCoordinateRecovery').addEventListener('click', applyCoordinateRecovery);
  $('recoveryConfirm').addEventListener('change', () => { state.batchRecoveryConfirmed = $('recoveryConfirm').checked; updateBatchPreview(); });
  $('downloadAgain').addEventListener('click', () => { if (state.zipBlob) downloadBlob(state.zipBlob, state.zipFilename); });

  dropzone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); folderInput.click(); } });
  ['dragenter','dragover'].forEach(name => dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(name => dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', event => showFiles(Array.from(event.dataTransfer?.files || []), 'Foto dari drag & drop'));

  window.GeoTagStudioCore = Object.freeze({ writeExifGps, readXlsxCoordinates, groupBatchFiles, parseCoordinate, collapsedCoordinateDigits, decimalRestorationCandidates });
  updateCoordinatePreview();
  updateBatchOutputMode();
  updateBatchPreview();
})();
