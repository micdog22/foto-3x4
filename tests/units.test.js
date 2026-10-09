import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mmToPx, mmToPxExact, pxToMm, sizeInPx, PHOTOS, PAPERS, formatMm, MM_PER_INCH } from '../src/units.js';

test('mmToPx a 300 dpi: tamanhos de referência', () => {
  assert.equal(mmToPx(100), 1181); // 10 cm
  assert.equal(mmToPx(150), 1772); // 15 cm
  assert.equal(mmToPx(30), 354); // 3 cm
  assert.equal(mmToPx(40), 472); // 4 cm
  assert.equal(mmToPx(50), 591); // 5 cm
  assert.equal(mmToPx(70), 827); // 7 cm
  assert.equal(mmToPx(210), 2480); // A4
  assert.equal(mmToPx(297), 3508);
  assert.equal(mmToPx(25.4), 300); // uma polegada
  assert.equal(mmToPx(2), 24);
});

test('mmToPx em outras resoluções', () => {
  assert.equal(mmToPx(25.4, 72), 72);
  assert.equal(mmToPx(100, 600), 2362);
  assert.equal(mmToPx(210, 96), 794); // largura A4 em pixels CSS
});

test('mmToPxExact não arredonda e pxToMm é a inversa', () => {
  assert.ok(Math.abs(mmToPxExact(1) - 300 / 25.4) < 1e-12);
  for (const mm of [0, 0.5, 3, 30, 99.9, 297]) {
    assert.ok(Math.abs(pxToMm(mmToPxExact(mm)) - mm) < 1e-9);
  }
  assert.equal(MM_PER_INCH, 25.4);
});

test('arredondar para pixels inteiros erra no máximo meio pixel (0,042 mm a 300 dpi)', () => {
  for (let tenth = 0; tenth <= 3000; tenth++) {
    const mm = tenth / 10;
    assert.ok(Math.abs(pxToMm(mmToPx(mm)) - mm) <= 25.4 / 300 / 2 + 1e-12, `${mm} mm`);
  }
});

test('sizeInPx das fotos e papéis cadastrados', () => {
  assert.deepEqual(sizeInPx(PHOTOS['3x4']), { w: 354, h: 472 });
  assert.deepEqual(sizeInPx(PHOTOS['5x7']), { w: 591, h: 827 });
  assert.deepEqual(sizeInPx(PAPERS['10x15']), { w: 1181, h: 1772 });
  assert.deepEqual(sizeInPx(PAPERS.a4), { w: 2480, h: 3508 });
});

test('formatMm usa vírgula decimal', () => {
  assert.equal(formatMm(2.5), '2,5');
  assert.equal(formatMm(10), '10');
  assert.equal(formatMm(29.97, 2), '29,97');
});
