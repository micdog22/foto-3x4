import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coverScale, halfExtents, createCrop, cropScale, clampCrop, cropMatrix, imageToOutput, outputToImage,
  frameCorners, panCrop, zoomCropAt, rotateCrop, normalizeDegrees, mipLevel, faceGuides, MIN_ZOOM, MAX_ZOOM,
} from '../src/crop.js';

const OUT_W = 354;
const OUT_H = 472;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertCornersInside(crop, outW = OUT_W, outH = OUT_H, eps = 1e-6) {
  for (const p of frameCorners(crop, outW, outH)) {
    assert.ok(p.x >= -eps && p.x <= crop.imgW + eps && p.y >= -eps && p.y <= crop.imgH + eps,
      `canto (${p.x.toFixed(3)}, ${p.y.toFixed(3)}) fora da foto ${crop.imgW}x${crop.imgH} (rot ${crop.rotation}, zoom ${crop.zoom})`);
  }
}

test('coverScale sem rotação: o lado mais justo manda', () => {
  near(coverScale(1000, 2000, OUT_W, OUT_H, 0), 0.354);
  near(coverScale(4000, 3000, OUT_W, OUT_H, 0), 472 / 3000);
  near(coverScale(1200, 1600, OUT_W, OUT_H, 0), 0.295); // mesma proporção 3:4
});

test('coverScale com 90 graus troca os lados; com 45 graus usa a caixa envolvente', () => {
  near(coverScale(1000, 2000, OUT_W, OUT_H, Math.PI / 2), 0.472);
  const r = Math.SQRT1_2;
  near(coverScale(1000, 1000, 400, 400, Math.PI / 4), (400 * r + 400 * r) / 1000);
});

test('halfExtents: caixa do quadro em pixels da foto', () => {
  const { ex, ey } = halfExtents(OUT_W, OUT_H, 0, 0.59);
  near(ex, 300);
  near(ey, 400);
});

test('exemplo numérico: foto 1200x1600, zoom 2, centralizada', () => {
  const crop = clampCrop({ ...createCrop(1200, 1600), zoom: 2 }, OUT_W, OUT_H);
  near(cropScale(crop, OUT_W, OUT_H), 0.59);
  const tl = outputToImage(crop, OUT_W, OUT_H, 0, 0);
  const br = outputToImage(crop, OUT_W, OUT_H, OUT_W, OUT_H);
  near(tl.x, 300); near(tl.y, 400);
  near(br.x, 900); near(br.y, 1200);
});

test('zoom 1 com a mesma proporção cobre a foto inteira', () => {
  const crop = createCrop(1200, 1600);
  const corners = frameCorners(crop, OUT_W, OUT_H);
  const expected = [[0, 0], [1200, 0], [1200, 1600], [0, 1600]];
  corners.forEach((p, i) => { near(p.x, expected[i][0]); near(p.y, expected[i][1]); });
});

test('rotação de 90 graus: o canto de cima à esquerda do quadro vem do canto de baixo à esquerda da foto', () => {
  const crop = clampCrop(createCrop(1600, 1200, 90), OUT_W, OUT_H);
  const tl = outputToImage(crop, OUT_W, OUT_H, 0, 0);
  near(tl.x, 0); near(tl.y, 1200);
  const tr = outputToImage(crop, OUT_W, OUT_H, OUT_W, 0);
  near(tr.x, 0); near(tr.y, 0);
});

test('cropMatrix equivale a translate, rotate, scale e translate do canvas', () => {
  const crop = clampCrop({ imgW: 3000, imgH: 4000, zoom: 1.7, rotation: 12.5, cx: 1400, cy: 1700 }, OUT_W, OUT_H);
  const s = cropScale(crop, OUT_W, OUT_H);
  const t = (crop.rotation * Math.PI) / 180;
  // composição manual das matrizes [a c e; b d f; 0 0 1]
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const T = (x, y) => [1, 0, 0, 1, x, y];
  const R = (a) => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
  const S = (k) => [k, 0, 0, k, 0, 0];
  const manual = mul(mul(mul(T(OUT_W / 2, OUT_H / 2), R(t)), S(s)), T(-crop.cx, -crop.cy));
  cropMatrix(crop, OUT_W, OUT_H).forEach((v, i) => near(v, manual[i], 1e-9));
});

test('o centro do quadro mostra o ponto (cx, cy) e ida e volta é identidade', () => {
  const rnd = mulberry32(7);
  for (let i = 0; i < 300; i++) {
    const crop = clampCrop({ imgW: 500 + rnd() * 5000, imgH: 500 + rnd() * 5000, zoom: 1 + rnd() * 7, rotation: rnd() * 360 - 180, cx: rnd() * 6000, cy: rnd() * 6000 }, OUT_W, OUT_H);
    const c = outputToImage(crop, OUT_W, OUT_H, OUT_W / 2, OUT_H / 2);
    near(c.x, crop.cx, 1e-6);
    near(c.y, crop.cy, 1e-6);
    const qx = rnd() * OUT_W;
    const qy = rnd() * OUT_H;
    const p = outputToImage(crop, OUT_W, OUT_H, qx, qy);
    const back = imageToOutput(crop, OUT_W, OUT_H, p.x, p.y);
    near(back.x, qx, 1e-6);
    near(back.y, qy, 1e-6);
  }
});

test('clampCrop: com qualquer foto, zoom, rotação e posição, o quadro fica coberto', () => {
  const rnd = mulberry32(2026);
  for (let i = 0; i < 2000; i++) {
    const crop = clampCrop({
      imgW: 300 + rnd() * 6000, imgH: 300 + rnd() * 6000, zoom: rnd() * 12,
      rotation: rnd() * 720 - 360, cx: rnd() * 8000 - 1000, cy: rnd() * 8000 - 1000,
    }, OUT_W, OUT_H);
    assert.ok(crop.zoom >= MIN_ZOOM && crop.zoom <= MAX_ZOOM);
    assert.ok(crop.rotation > -180 && crop.rotation <= 180);
    assertCornersInside(crop);
  }
});

test('clampCrop não mexe num recorte válido e é idempotente', () => {
  const ok = { imgW: 4000, imgH: 3000, zoom: 3, rotation: 5, cx: 2000, cy: 1500 };
  assert.deepEqual(clampCrop(ok, OUT_W, OUT_H), ok);
  const once = clampCrop({ ...ok, cx: -999, zoom: 50 }, OUT_W, OUT_H);
  assert.deepEqual(clampCrop(once, OUT_W, OUT_H), once);
  assert.equal(once.zoom, MAX_ZOOM);
});

test('clampCrop trata valores inválidos', () => {
  const c = clampCrop({ imgW: 1000, imgH: 1000, zoom: NaN, rotation: Infinity, cx: undefined, cy: null }, OUT_W, OUT_H);
  assert.equal(c.zoom, 1);
  assert.equal(c.rotation, 0);
  near(c.cx, 500);
  assertCornersInside(c);
});

test('panCrop: o ponto sob o dedo acompanha o arraste', () => {
  const crop = clampCrop({ ...createCrop(4000, 3000), zoom: 4, rotation: 17 }, OUT_W, OUT_H);
  const q = { x: 100, y: 200 };
  const p = outputToImage(crop, OUT_W, OUT_H, q.x, q.y);
  const moved = panCrop(crop, OUT_W, OUT_H, 30, -20);
  const now = imageToOutput(moved, OUT_W, OUT_H, p.x, p.y);
  near(now.x, 130, 1e-6);
  near(now.y, 180, 1e-6);
});

test('panCrop para na borda da foto', () => {
  let crop = clampCrop({ ...createCrop(2000, 2000), zoom: 2, rotation: -8 }, OUT_W, OUT_H);
  crop = panCrop(crop, OUT_W, OUT_H, 1e6, 1e6);
  assertCornersInside(crop);
  const again = panCrop(crop, OUT_W, OUT_H, 50, 50);
  near(again.cx, crop.cx);
  near(again.cy, crop.cy);
});

test('zoomCropAt: o ponto sob o cursor fica parado', () => {
  const crop = clampCrop({ ...createCrop(4000, 3000), zoom: 2, rotation: 10 }, OUT_W, OUT_H);
  const q = { x: 200, y: 150 };
  const before = outputToImage(crop, OUT_W, OUT_H, q.x, q.y);
  const z = zoomCropAt(crop, OUT_W, OUT_H, 3, q.x, q.y);
  assert.equal(z.zoom, 3);
  const after = outputToImage(z, OUT_W, OUT_H, q.x, q.y);
  near(after.x, before.x, 1e-6);
  near(after.y, before.y, 1e-6);
  assert.equal(zoomCropAt(crop, OUT_W, OUT_H, 99).zoom, MAX_ZOOM);
  assert.equal(zoomCropAt(crop, OUT_W, OUT_H, 0.1).zoom, MIN_ZOOM);
});

test('rotateCrop mantém o zoom relativo e reajusta a cobertura', () => {
  let crop = clampCrop({ ...createCrop(3000, 4000), zoom: 1 }, OUT_W, OUT_H);
  for (const deg of [5, 15, 30, 45, -45, 90, 135, 180, -90]) {
    crop = rotateCrop(crop, OUT_W, OUT_H, deg);
    assert.equal(crop.zoom, 1);
    near(crop.rotation, normalizeDegrees(deg));
    assertCornersInside(crop);
  }
  // escala cresce com a rotação: girar 30 graus exige aproximar
  const r0 = cropScale(rotateCrop(crop, OUT_W, OUT_H, 0), OUT_W, OUT_H);
  const r30 = cropScale(rotateCrop(crop, OUT_W, OUT_H, 30), OUT_W, OUT_H);
  assert.ok(r30 > r0);
});

test('normalizeDegrees', () => {
  assert.equal(normalizeDegrees(190), -170);
  assert.equal(normalizeDegrees(-180), 180);
  assert.equal(normalizeDegrees(180), 180);
  assert.equal(normalizeDegrees(360), 0);
  assert.equal(normalizeDegrees(-450), -90);
  assert.equal(normalizeDegrees(45.5), 45.5);
});

test('mipLevel: reduções pela metade até a escala final ficar entre 0,5 e 1', () => {
  assert.equal(mipLevel(2), 0);
  assert.equal(mipLevel(1), 0);
  assert.equal(mipLevel(0.5), 0);
  assert.equal(mipLevel(0.49), 1);
  assert.equal(mipLevel(0.1), 3);
  assert.equal(mipLevel(0.01), 6);
  for (const s of [0.9, 0.3, 0.07, 0.02]) {
    const rest = s * 2 ** mipLevel(s);
    assert.ok(rest >= 0.5 && rest < 1);
  }
});

test('guias do rosto: ordem e limites coerentes', () => {
  for (const id of ['3x4', '5x7', 'outra']) {
    const g = faceGuides(id);
    assert.ok(g.top > 0 && g.top < g.eyes && g.eyes < g.chin && g.chin < 1);
    assert.ok(g.halfWidth > 0 && g.halfWidth < 0.5);
  }
});
