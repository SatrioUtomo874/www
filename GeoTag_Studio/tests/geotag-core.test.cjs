const test = require('node:test');
const assert = require('node:assert/strict');
const { writeExifGps } = require('../exif-gps.js');

function makeBareJpeg(extra = []) {
  return new Uint8Array([0xff, 0xd8, ...extra, 0xff, 0xd9]);
}

function locateExif(jpeg) {
  let p = 2;
  while (p + 4 <= jpeg.length) {
    if (jpeg[p] !== 0xff) break;
    while (jpeg[p] === 0xff) p++;
    const marker = jpeg[p++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = (jpeg[p] << 8) | jpeg[p + 1];
    if (marker === 0xe1 && length >= 8 && String.fromCharCode(...jpeg.slice(p + 2, p + 8)) === 'Exif\0\0') {
      const tiffStart = p + 8;
      const little = jpeg[tiffStart] === 0x49;
      const view = new DataView(jpeg.buffer, jpeg.byteOffset + tiffStart, jpeg.length - tiffStart);
      const u16 = x => view.getUint16(x, little);
      const u32 = x => view.getUint32(x, little);
      const ifd0 = u32(4);
      const count = u16(ifd0);
      let gpsOffset = null;
      for (let i = 0; i < count; i++) {
        const entry = ifd0 + 2 + i * 12;
        if (u16(entry) === 0x8825) gpsOffset = u32(entry + 8);
      }
      assert.notEqual(gpsOffset, null, 'GPSInfoIFDPointer harus tersedia');
      const gpsCount = u16(gpsOffset);
      const entries = new Map();
      for (let i = 0; i < gpsCount; i++) {
        const entry = gpsOffset + 2 + i * 12;
        entries.set(u16(entry), {
          type: u16(entry + 2), count: u32(entry + 4), value: u32(entry + 8), entry
        });
      }
      function ascii(tag) {
        const item = entries.get(tag);
        return String.fromCharCode(view.getUint8(item.entry + 8));
      }
      function rationalTriplet(tag) {
        const item = entries.get(tag);
        const arr = [];
        for (let i = 0; i < 3; i++) {
          const offset = item.value + i * 8;
          arr.push(view.getUint32(offset, little) / view.getUint32(offset + 4, little));
        }
        return arr;
      }
      const dms = (values) => values[0] + values[1] / 60 + values[2] / 3600;
      return {
        latitude: dms(rationalTriplet(0x0002)) * (ascii(0x0001) === 'S' ? -1 : 1),
        longitude: dms(rationalTriplet(0x0004)) * (ascii(0x0003) === 'W' ? -1 : 1),
        datumExists: entries.has(0x0012),
        versionExists: entries.has(0x0000)
      };
    }
    p += length;
  }
  throw new Error('EXIF APP1 tidak ditemukan');
}

test('menambahkan GPS WGS-84 ke JPEG tanpa EXIF', () => {
  const source = makeBareJpeg();
  const output = writeExifGps(source, -7.2575, 112.7521);
  assert.deepEqual(Array.from(output.slice(0, 2)), [0xff, 0xd8]);
  assert.deepEqual(Array.from(output.slice(-2)), [0xff, 0xd9]);
  const gps = locateExif(output);
  assert.ok(Math.abs(gps.latitude - (-7.2575)) < 1e-6);
  assert.ok(Math.abs(gps.longitude - 112.7521) < 1e-6);
  assert.equal(gps.datumExists, true);
  assert.equal(gps.versionExists, true);
});

test('memperbarui koordinat GPS yang sudah ada tanpa menggandakan APP1 EXIF', () => {
  const first = writeExifGps(makeBareJpeg(), -7.2, 112.7);
  const second = writeExifGps(first, 35.6895, -139.6917);
  const gps = locateExif(second);
  assert.ok(Math.abs(gps.latitude - 35.6895) < 1e-6);
  assert.ok(Math.abs(gps.longitude - (-139.6917)) < 1e-6);
  const exifMatches = second.join(',').match(/255,225/g) || [];
  assert.equal(exifMatches.length, 1);
});

test('mempertahankan segmen JPEG non-EXIF dan bytes gambar', () => {
  const body = [0xff, 0xe0, 0x00, 0x04, 0x01, 0x02, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0x33];
  const source = makeBareJpeg(body);
  const output = writeExifGps(source, 0, 0);
  const payload = [0xff, 0xe0, 0x00, 0x04, 0x01, 0x02, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9];
  const at = output.findIndex((value, index) => index > 3 && value === 0xff && output[index + 1] === 0xe0);
  assert.deepEqual(Array.from(output.slice(at, at + payload.length)), payload);
});

test('menolak JPEG invalid', () => {
  assert.throws(() => writeExifGps(new Uint8Array([0x00, 0x01, 0x02, 0x03]), 1, 1), /JPEG yang valid/);
});

test('menolak koordinat di luar rentang atau non-finite', () => {
  const jpeg = makeBareJpeg();
  assert.throws(() => writeExifGps(jpeg, 91, 0), /Latitude/);
  assert.throws(() => writeExifGps(jpeg, 0, 181), /Longitude/);
  assert.throws(() => writeExifGps(jpeg, NaN, 0), /Latitude/);
});

test('mendukung EXIF TIFF big-endian dari kamera', () => {
  const tiffBigEndian = [
    0x4d, 0x4d, 0x00, 0x2a,
    0x00, 0x00, 0x00, 0x08,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00
  ];
  const app1Length = 8 + tiffBigEndian.length;
  const exifSegment = [
    0xff, 0xe1, (app1Length >> 8) & 0xff, app1Length & 0xff,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    ...tiffBigEndian
  ];
  const source = makeBareJpeg(exifSegment);
  const output = writeExifGps(source, -33.8688, 151.2093);
  const gps = locateExif(output);
  assert.ok(Math.abs(gps.latitude - (-33.8688)) < 1e-6);
  assert.ok(Math.abs(gps.longitude - 151.2093) < 1e-6);
});
