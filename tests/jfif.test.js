import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { headerSegments, readJfifDensity, setJpegDpi } from '../src/jfif.js';

const ascii = (s) => Array.from(Buffer.from(s, 'latin1'));
const seg = (marker, payload) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload];
const JFIF_101 = seg(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const BODY = [
  ...seg(0xdb, [0, ...new Array(64).fill(3)]),
  ...seg(0xc0, [8, 1, 0xd8, 1, 0x62, 1, 1, 0x11, 0]),
  ...seg(0xc4, [0, ...new Array(16).fill(0)]),
  ...seg(0xda, [1, 1, 0, 0, 63, 0]),
  0x12, 0xff, 0x00, 0x34, 0xff, 0xd9,
];

const jpeg = (...parts) => new Uint8Array([0xff, 0xd8, ...parts.flat()]);

test('headerSegments lista o cabeçalho até o SOS', () => {
  const s = headerSegments(jpeg(JFIF_101, BODY));
  assert.deepEqual(s.map((x) => x.marker), [0xe0, 0xdb, 0xc0, 0xc4, 0xda]);
  assert.equal(s[0].offset, 2);
  assert.equal(s[0].end, 20);
});

test('JFIF existente: troca só unidade e densidades', () => {
  const input = jpeg(JFIF_101, BODY);
  assert.deepEqual(readJfifDensity(input), { units: 0, x: 1, y: 1 });
  const { bytes, inserted, removedExif } = setJpegDpi(input, 300);
  assert.equal(inserted, false);
  assert.equal(removedExif, 0);
  assert.equal(bytes.length, input.length);
  assert.deepEqual(readJfifDensity(bytes), { units: 1, x: 300, y: 300 });
  // bytes 13 a 17 do arquivo (unidade e densidades) mudaram; o resto é igual
  const diff = [];
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== input[i]) diff.push(i);
  assert.deepEqual(diff, [13, 14, 15, 16, 17]);
  assert.deepEqual(Array.from(bytes.subarray(13, 18)), [1, 0x01, 0x2c, 0x01, 0x2c]);
});

test('JFIF 1.02 com miniatura: a miniatura é preservada', () => {
  const thumb = [10, 20, 30, 40, 50, 60];
  const app0 = seg(0xe0, [...ascii('JFIF\0'), 1, 2, 2, 0, 28, 0, 28, 2, 1, ...thumb]);
  const input = jpeg(app0, BODY);
  assert.deepEqual(readJfifDensity(input), { units: 2, x: 28, y: 28 });
  const { bytes } = setJpegDpi(input, 254);
  assert.deepEqual(readJfifDensity(bytes), { units: 1, x: 254, y: 254 });
  assert.deepEqual(Array.from(bytes.subarray(20, 26)), thumb);
  assert.equal(bytes.length, input.length);
});

test('sem APP0: um JFIF 1.01 é inserido logo depois do SOI', () => {
  const input = jpeg(BODY);
  assert.equal(readJfifDensity(input), null);
  const { bytes, inserted } = setJpegDpi(input, 300);
  assert.equal(inserted, true);
  assert.equal(bytes.length, input.length + 18);
  assert.deepEqual(Array.from(bytes.subarray(0, 20)), [
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x01, 0x2c, 0x01, 0x2c, 0x00, 0x00,
  ]);
  assert.deepEqual(bytes.subarray(20), input.subarray(2));
});

test('Exif é removido (pode trazer 72 dpi) e os outros segmentos ficam', () => {
  const exif = seg(0xe1, [...ascii('Exif\0\0'), ...ascii('MM\0*'), 0, 0, 0, 8, 0, 0]);
  const icc = seg(0xe2, [...ascii('ICC_PROFILE\0'), 1, 1, 9, 9]);
  const adobe = seg(0xee, [...ascii('Adobe'), 0, 100, 0, 0, 0, 0, 1]);
  const input = jpeg(JFIF_101, exif, icc, adobe, BODY);
  const { bytes, removedExif } = setJpegDpi(input, 300);
  assert.equal(removedExif, 1);
  assert.equal(bytes.length, input.length - exif.length);
  assert.deepEqual(headerSegments(bytes).map((x) => x.marker), [0xe0, 0xe2, 0xee, 0xdb, 0xc0, 0xc4, 0xda]);
  assert.deepEqual(readJfifDensity(bytes), { units: 1, x: 300, y: 300 });
  // sem JFIF e com Exif: Exif sai e JFIF entra
  const noJfif = setJpegDpi(jpeg(exif, BODY), 300);
  assert.equal(noJfif.inserted, true);
  assert.deepEqual(headerSegments(noJfif.bytes).map((x) => x.marker), [0xe0, 0xdb, 0xc0, 0xc4, 0xda]);
});

test('bytes de preenchimento (FF FF) antes de um marcador são aceitos', () => {
  const input = jpeg(JFIF_101, [0xff], BODY);
  const { bytes } = setJpegDpi(input, 300);
  assert.deepEqual(readJfifDensity(bytes), { units: 1, x: 300, y: 300 });
  assert.equal(bytes.length, input.length);
});

test('aplicar duas vezes dá o mesmo arquivo', () => {
  const once = setJpegDpi(jpeg(BODY), 300).bytes;
  const twice = setJpegDpi(once, 300).bytes;
  assert.deepEqual(twice, once);
});

test('erros: não JPEG, truncado, sem SOS e dpi inválido', () => {
  assert.throws(() => setJpegDpi(new Uint8Array(ascii('PNG...')), 300), /Não é um arquivo JPEG/);
  assert.throws(() => setJpegDpi(jpeg(JFIF_101).subarray(0, 10), 300), /truncado/);
  assert.throws(() => setJpegDpi(jpeg(JFIF_101, [0xff, 0xd9]), 300), /EOI antes do SOS/);
  assert.throws(() => setJpegDpi(jpeg(JFIF_101), 300), /sem segmento SOS/);
  for (const bad of [0, -1, 2.5, 65536, NaN]) assert.throws(() => setJpegDpi(jpeg(BODY), bad), RangeError);
  assert.throws(() => setJpegDpi([0xff, 0xd8], 300), /Não é um arquivo JPEG/);
});

// ---------- diferencial com o sips (macOS) ----------

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function tinyPng(w, h) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([x * 4, y * 4, 128], y * (1 + w * 3) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('diferencial com sips: a densidade gravada é a que o macOS lê', { skip: !existsSync('/usr/bin/sips') && 'sips indisponível' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'foto3x4-'));
  try {
    writeFileSync(join(dir, 'a.png'), tinyPng(60, 40));
    execFileSync('sips', ['-s', 'format', 'jpeg', join(dir, 'a.png'), '--out', join(dir, 'a.jpg')], { stdio: 'ignore' });
    const original = new Uint8Array(readFileSync(join(dir, 'a.jpg')));
    for (const dpi of [300, 254]) {
      const out = join(dir, `b${dpi}.jpg`);
      writeFileSync(out, setJpegDpi(original, dpi).bytes);
      const info = execFileSync('sips', ['-g', 'dpiWidth', '-g', 'dpiHeight', '-g', 'pixelWidth', out], { encoding: 'utf8' });
      assert.match(info, new RegExp(`dpiWidth: ${dpi}\\.0`));
      assert.match(info, new RegExp(`dpiHeight: ${dpi}\\.0`));
      assert.match(info, /pixelWidth: 60/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
