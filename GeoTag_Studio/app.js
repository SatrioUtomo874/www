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
    batchRecoveryApplied: false, batchRecoveryConfirmed: false
  };

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
    $('batchButtonLabel').textContent = state.running ? 'Sedang memproses...' : state.batchExcelLoading ? 'Membaca Excel...' : !state.batchExcelName ? 'Pilih file Excel terlebih dahulu' : !hasBatchFolders ? 'Pilih folder foto terlebih dahulu' : unresolvedRecovery ? 'Periksa dan setujui pemulihan koordinat terlebih dahulu' : !hasMatch ? 'Belum ada pasangan koordinat dan folder yang valid' : `Proses ${eligiblePhotoCount} foto dalam Mode Batch`;
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
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
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

  function finishResult(summary, success, failed, skipped, ignored, blob, filename) {
    state.zipBlob = blob;
    state.zipFilename = filename;
    downloadBlob(blob, filename);
    $('progressTitle').textContent = 'Proses selesai';
    $('progressStatus').textContent = 'ZIP berhasil dibuat';
    $('progressPercent').textContent = '100%';
    $('progressFill').style.width = '100%';
    $('resultSummary').textContent = summary;
    $('resultDetails').innerHTML = `<span><strong>${success}</strong> berhasil</span><span><strong>${failed}</strong> gagal</span>${skipped ? `<span><strong>${skipped}</strong> tanpa GPS</span>` : ''}${ignored ? `<span><strong>${ignored}</strong> folder diabaikan</span>` : ''}<span><strong>${formatBytes(blob.size)}</strong> ukuran ZIP</span>`;
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

    beginProgress('Memproses foto...', state.files.length);
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
        zip.file(relative, tagged, { binary: true, date: file.lastModified ? new Date(file.lastModified) : new Date() });
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
    $('progressStatus').textContent = 'Membuat file ZIP...';
    $('currentFile').textContent = 'Mengemas foto dan laporan...';
    try {
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, meta => { $('progressStatus').textContent = `Mengemas ZIP ${Math.round(meta.percent || 0)}%`; });
      const filename = cleanZipName($('zipName').value, 'hasil_geotag_foto');
      finishResult(failed === 0 ? `${success} foto berhasil diberi metadata GPS. File ZIP sudah diunduh.` : `${success} foto berhasil diberi GPS, ${failed} foto tidak dapat diubah dan tetap disertakan sebagai file asli dalam ZIP.`, success, failed, 0, 0, blob, filename);
      $('progressCount').textContent = `${success} berhasil · ${failed} gagal`;
    } catch (error) {
      alert('Gagal membuat ZIP: ' + (error.message || error));
      $('progressStatus').textContent = 'Gagal membuat ZIP';
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
    for (const cell of localElements(sheetDoc, 'c')) {
      const ref = cell.getAttribute('r') || '';
      const match = /^([A-Z]+)(\d+)$/i.exec(ref);
      if (!match) continue;
      const column = match[1].toUpperCase();
      if (column !== 'B' && column !== 'C') continue;
      const row = Number(match[2]);
      if (!Number.isSafeInteger(row) || row < 2) continue;
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
      if (!rawRows.has(row)) rawRows.set(row, { lat: '', lon: '' });
      if (column === 'B') rawRows.get(row).lat = value;
      if (column === 'C') rawRows.get(row).lon = value;
      if (value !== '') maxFolder = Math.max(maxFolder, row - 1);
    }
    if (maxFolder < 1) throw new Error('Belum ada koordinat di Excel. Isi Latitude kolom B dan Longitude kolom C mulai baris 2.');

    const coordinates = new Map();
    for (const [row, raw] of rawRows.entries()) {
      if (raw.lat === '' && raw.lon === '') continue;
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
      coordinates.set(folderNo, { valid, lat, lon, rawLat: raw.lat, rawLon: raw.lon, reason, repairLat, repairLon, repairable, recovered: false });
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
      if (segments.length < 3 || !/^\d+$/.test(segments[1])) { unsorted++; continue; }
      const folderNo = Number(segments[1]);
      if (!Number.isSafeInteger(folderNo) || folderNo < 1) { unsorted++; continue; }
      if (!rootName) rootName = segments[0];
      if (!groups.has(folderNo)) groups.set(folderNo, []);
      groups.get(folderNo).push({ file, relative: safeZipPath(segments.slice(1).join('/')) });
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
      const values = [String(folderNo), coord?.valid ? (coord.recovered ? coord.recoveredLatText : coord.lat.toFixed(6)) : (coord?.rawLat || '—'), coord?.valid ? (coord.recovered ? coord.recoveredLonText : coord.lon.toFixed(6)) : (coord?.rawLon || '—'), String(files.length)];
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
    if (typeof JSZip === 'undefined') { alert('Library ZIP tidak ditemukan. Pastikan folder lib tidak dipindahkan.'); return; }

    const folders = Array.from(state.batchGroups.keys()).sort((a,b) => a-b);
    const eligibleGroups = folders.filter(n => n <= state.batchMaxFolder);
    const totalEligibleFiles = eligibleGroups.reduce((sum, n) => sum + state.batchGroups.get(n).length, 0);
    if (!totalEligibleFiles) { alert('Tidak ada foto yang berada dalam jangkauan nomor koordinat Excel.'); return; }

    beginProgress('Memproses Mode Batch...', totalEligibleFiles);
    const zip = new JSZip();
    const report = [['nomor_folder','nama_file','status','latitude','longitude','ukuran_asli','pesan']];
    let success = 0, failed = 0, skipped = 0, ignoredFolders = 0, unreadable = 0, done = 0;

    for (const folderNo of folders) {
      const files = state.batchGroups.get(folderNo) || [];
      if (folderNo > state.batchMaxFolder) {
        ignoredFolders++;
        for (const entry of files) report.push([folderNo, entry.relative, 'DIABAIKAN', '', '', entry.file.size, `Nomor folder melebihi nomor koordinat terakhir di Excel (${state.batchMaxFolder})`]);
        continue;
      }
      const coord = state.batchCoordinates.get(folderNo);
      for (const entry of files) {
        const { file, relative } = entry;
        $('currentFile').textContent = `Folder ${folderNo} / ${relative}`;
        let originalBytes = null;
        try {
          originalBytes = new Uint8Array(await file.arrayBuffer());
          if (!coord || !coord.valid) {
            zip.file(relative, originalBytes, { binary: true, date: file.lastModified ? new Date(file.lastModified) : new Date() });
            skipped++;
            report.push([folderNo, relative, 'TANPA GPS', coord?.rawLat || '', coord?.rawLon || '', file.size, coord?.reason || 'Baris koordinat untuk folder ini kosong']);
          } else {
            const tagged = writeExifGps(originalBytes, coord.lat, coord.lon);
            zip.file(relative, tagged, { binary: true, date: file.lastModified ? new Date(file.lastModified) : new Date() });
            success++;
            report.push([folderNo, relative, 'BERHASIL', coord.lat.toFixed(6), coord.lon.toFixed(6), file.size, coord.recovered ? 'GPS EXIF berhasil ditambahkan menggunakan koordinat hasil pemulihan desimal yang disetujui pengguna' : 'GPS EXIF berhasil ditambahkan']);
          }
        } catch (error) {
          failed++;
          if (originalBytes) {
            zip.file(relative, originalBytes, { binary: true, date: file.lastModified ? new Date(file.lastModified) : new Date() });
            report.push([folderNo, relative, 'GAGAL', coord?.lat ?? coord?.rawLat ?? '', coord?.lon ?? coord?.rawLon ?? '', file.size, String(error && error.message ? error.message : error)]);
          } else {
            unreadable++;
            report.push([folderNo, relative, 'GAGAL BACA', coord?.rawLat || '', coord?.rawLon || '', file.size, String(error && error.message ? error.message : error)]);
          }
        }
        done++;
        updateProgress(done, totalEligibleFiles, `Folder ${folderNo} / ${relative}`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    report.push([]);
    report.push(['Ringkasan','','','','','',`Berhasil: ${success}; gagal: ${failed}; tanpa GPS: ${skipped}; tidak dapat dibaca: ${unreadable}; folder diabaikan: ${ignoredFolders}`]);
    report.push(['Catatan','','','','','','Folder bernomor di atas nomor koordinat terakhir di Excel tidak dimasukkan ke hasil ZIP.']);
    zip.file('laporan_batch_geotag.csv', csvText(report));
    $('progressStatus').textContent = 'Membuat file ZIP...';
    $('currentFile').textContent = 'Mengemas foto dan laporan batch...';
    try {
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, meta => { $('progressStatus').textContent = `Mengemas ZIP ${Math.round(meta.percent || 0)}%`; });
      const filename = cleanZipName($('batchZipName').value, 'hasil_geotag_batch');
      const summary = `${success} foto berhasil diberi GPS. ${failed} foto gagal diproses; file yang berhasil dibaca tetap disertakan sebagai file asli. ${unreadable ? `${unreadable} foto tidak dapat dibaca sehingga tidak dapat dimasukkan ke ZIP. ` : ''}${skipped} foto tidak memiliki koordinat valid dan disertakan tanpa GPS. ${ignoredFolders} folder dengan nomor di atas batas Excel diabaikan.`;
      finishResult(summary, success, failed, skipped, ignoredFolders, blob, filename);
      $('progressCount').textContent = `${success} berhasil · ${failed} gagal · ${skipped} tanpa GPS`;
    } catch (error) {
      alert('Gagal membuat ZIP: ' + (error.message || error));
      $('progressStatus').textContent = 'Gagal membuat ZIP';
    } finally {
      state.running = false; validateReady();
    }
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
  updateBatchPreview();
})();
