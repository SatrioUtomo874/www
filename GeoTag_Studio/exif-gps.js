/* GeoTag Studio EXIF GPS metadata core.
 * The JPEG image stream is preserved; only the EXIF APP1 metadata segment is replaced/added.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeoTagStudioCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // --- Minimal lossless EXIF GPS writer. It appends a new GPS IFD and a copied IFD0,
  //    leaving the original TIFF payload and all existing image bytes untouched. ---
  function writeExifGps(jpegBytes, latitude, longitude) {
    if (!(jpegBytes instanceof Uint8Array)) jpegBytes = new Uint8Array(jpegBytes);
    latitude = Number(latitude);
    longitude = Number(longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new RangeError('Latitude harus berada di antara -90 dan 90.');
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new RangeError('Longitude harus berada di antara -180 dan 180.');
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


  return Object.freeze({ writeExifGps });
});
