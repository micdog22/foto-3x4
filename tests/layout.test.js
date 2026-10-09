import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitCount, computeLayout, cutGuides, suggestTighter, checkLayout } from '../src/layout.js';
import { mmToPx } from '../src/units.js';

const mm10x15 = { sheetW: 100, sheetH: 150 };
const mmA4 = { sheetW: 210, sheetH: 297 };
const p3x4 = { photoW: 30, photoH: 40 };
const p5x7 = { photoW: 50, photoH: 70 };

test('fitCount: n células com espaço entre elas', () => {
  assert.equal(fitCount(100, 30, 0), 3);
  assert.equal(fitCount(96, 30, 2), 3); // 3*30 + 2*2 = 94
  assert.equal(fitCount(93, 30, 2), 2);
  assert.equal(fitCount(94, 30, 2), 3); // cabe exatamente
  assert.equal(fitCount(29, 30, 0), 0);
  assert.equal(fitCount(-5, 30, 0), 0);
  assert.equal(fitCount(100, 0, 0), 0);
  // sem erro de ponto flutuante: 3 * 0.1 + ... cabe exatamente
  assert.equal(fitCount(0.3 + 0.2, 0.1, 0.1), 3);
});

test('3x4 em 10x15 em pé cabe 9 fotos (3 colunas x 3 linhas)', () => {
  const l = computeLayout({ ...mm10x15, ...p3x4, gap: 2, margin: 2 });
  assert.equal(l.cols, 3);
  assert.equal(l.rows, 3);
  assert.equal(l.count, 9);
  assert.equal(l.rotated, false);
  assert.deepEqual(l.cells.map((c) => [c.x, c.y]), [
    [3, 13], [35, 13], [67, 13],
    [3, 55], [35, 55], [67, 55],
    [3, 97], [35, 97], [67, 97],
  ]);
  assert.deepEqual(checkLayout(l, { ...mm10x15, gap: 2, margin: 2 }), []);
});

test('3x4 deitada em 10x15 caberia só 8: a orientação em pé vence', () => {
  const rotatedOnly = computeLayout({ sheetW: 100, sheetH: 150, photoW: 40, photoH: 30, gap: 2, margin: 2, allowRotate: false });
  assert.equal(rotatedOnly.count, 8);
  assert.equal(computeLayout({ ...mm10x15, ...p3x4, gap: 2, margin: 2 }).count, 9);
});

test('sem espaço nem margem, 3x4 deitada em 10x15 cabe 10 (2 x 5, rente à borda)', () => {
  const l = computeLayout({ ...mm10x15, ...p3x4, gap: 0, margin: 0 });
  assert.equal(l.count, 10);
  assert.equal(l.rotated, true);
  assert.deepEqual([l.cols, l.rows, l.x0, l.y0], [2, 5, 10, 0]);
  // presa em pé, continua 9
  const upright = computeLayout({ ...mm10x15, ...p3x4, gap: 0, margin: 0, allowRotate: false });
  assert.equal(upright.count, 9);
  assert.deepEqual([upright.x0, upright.y0], [5, 15]);
});

test('espaço grande reduz a quantidade e pode inverter a orientação', () => {
  const upright = computeLayout({ ...mm10x15, ...p3x4, gap: 5, margin: 2, allowRotate: false });
  assert.equal(upright.cols, 2); // (96 + 5) / 35 = 2,88
  assert.equal(upright.rows, 3);
  assert.equal(upright.count, 6);
  // deitada: (96 + 5) / 45 = 2 colunas e (146 + 5) / 35 = 4 linhas
  const free = computeLayout({ ...mm10x15, ...p3x4, gap: 5, margin: 2 });
  assert.deepEqual([free.rotated, free.cols, free.rows, free.count], [true, 2, 4, 8]);
});

test('5x7 em 10x15: 2 fotos com espaço; 4 encostadas, e a dica sugere isso', () => {
  const withGap = computeLayout({ ...mm10x15, ...p5x7, gap: 2, margin: 2 });
  assert.equal(withGap.count, 2);
  assert.equal(withGap.cols, 1);
  const tight = computeLayout({ ...mm10x15, ...p5x7, gap: 0, margin: 0 });
  assert.equal(tight.count, 4);
  assert.deepEqual(tight.cells.map((c) => [c.x, c.y]), [[0, 5], [50, 5], [0, 75], [50, 75]]);
  assert.deepEqual(suggestTighter({ ...mm10x15, ...p5x7, gap: 2, margin: 2 }), { capacity: 4, gap: 0, margin: 0 });
  // 3x4: a sugestão não troca a orientação, então não há o que sugerir
  assert.equal(suggestTighter({ ...mm10x15, ...p3x4, gap: 2, margin: 2 }), null);
  // quando zerar só o espaço já resolve, a margem é mantida
  assert.deepEqual(suggestTighter({ ...mm10x15, ...p3x4, gap: 6, margin: 2, allowRotate: false }), { capacity: 9, gap: 0, margin: 2 });
  // com a foto deitada, a sugestão continua deitada
  assert.deepEqual(suggestTighter({ ...mm10x15, ...p3x4, gap: 6, margin: 2 }), { capacity: 10, gap: 0, margin: 0 });
  assert.equal(suggestTighter({ ...mm10x15, ...p5x7, gap: 0, margin: 0 }), null);
});

test('A4 com margem de 6 mm: 36 fotos 3x4 e 10 fotos 5x7 (deitadas)', () => {
  const a = computeLayout({ ...mmA4, ...p3x4, gap: 2, margin: 6 });
  assert.equal(a.cols, 6);
  assert.equal(a.rows, 6);
  assert.equal(a.count, 36);
  assert.deepEqual(checkLayout(a, { ...mmA4, gap: 2, margin: 6 }), []);
  // 5x7 em pé: 3 x 3 = 9; deitada (70 x 50): 2 colunas x 5 linhas = 10
  const b = computeLayout({ ...mmA4, ...p5x7, gap: 2, margin: 6 });
  assert.equal(b.rotated, true);
  assert.deepEqual([b.cols, b.rows, b.count], [2, 5, 10]);
  assert.deepEqual(checkLayout(b, { ...mmA4, gap: 2, margin: 6 }), []);
});

test('foto deitada é escolhida quando cabe mais', () => {
  // folha 100 x 60 com foto 30 x 50: em pé cabem 3; deitada (50 x 30) cabem 2 x 2 = 4
  const l = computeLayout({ sheetW: 100, sheetH: 60, photoW: 30, photoH: 50, gap: 0, margin: 0 });
  assert.equal(l.rotated, true);
  assert.equal(l.count, 4);
  assert.ok(l.cells.every((c) => c.w === 50 && c.h === 30 && c.rotated));
});

test('maxCount limita e centraliza só as fotos usadas', () => {
  const l = computeLayout({ ...mm10x15, ...p3x4, gap: 2, margin: 2, maxCount: 4 });
  assert.equal(l.count, 4);
  assert.equal(l.capacity, 9);
  // 3 na primeira linha e 1 na segunda; bloco de 3 colunas x 2 linhas centralizado
  assert.deepEqual(l.cells.map((c) => [c.x, c.y]), [[3, 34], [35, 34], [67, 34], [3, 76]]);
  assert.equal(computeLayout({ ...mm10x15, ...p3x4, gap: 2, margin: 2, maxCount: 0 }).cells.length, 0);
  assert.equal(computeLayout({ ...mm10x15, ...p3x4, gap: 2, margin: 2, maxCount: 99 }).count, 9);
});

test('em pixels (300 dpi) com posições inteiras: 9 fotos de 354 x 472 em 1181 x 1772', () => {
  const l = computeLayout({
    sheetW: mmToPx(100), sheetH: mmToPx(150), photoW: mmToPx(30), photoH: mmToPx(40),
    gap: mmToPx(2), margin: mmToPx(2), integer: true,
  });
  assert.equal(l.count, 9);
  assert.deepEqual([...new Set(l.cells.map((c) => c.x))], [35, 413, 791]);
  assert.deepEqual([...new Set(l.cells.map((c) => c.y))], [154, 650, 1146]);
  assert.ok(l.cells.every((c) => Number.isInteger(c.x) && Number.isInteger(c.y) && c.w === 354 && c.h === 472));
  assert.deepEqual(checkLayout(l, { sheetW: 1181, sheetH: 1772, gap: 24, margin: 24 }), []);
  // a posição em pixels bate com a posição em mm (diferença menor que 1 pixel)
  const inMm = computeLayout({ ...mm10x15, ...p3x4, gap: 2, margin: 2 });
  l.cells.forEach((c, i) => {
    assert.ok(Math.abs(c.x - (inMm.cells[i].x * 300) / 25.4) < 1);
    assert.ok(Math.abs(c.y - (inMm.cells[i].y * 300) / 25.4) < 1);
  });
});

test('cutGuides: bordas únicas e ordenadas e a caixa do bloco', () => {
  const l = computeLayout({ ...mm10x15, ...p3x4, gap: 2, margin: 2 });
  const g = cutGuides(l.cells);
  assert.deepEqual(g.xs, [3, 33, 35, 65, 67, 97]);
  assert.deepEqual(g.ys, [13, 53, 55, 95, 97, 137]);
  assert.deepEqual([g.left, g.top, g.right, g.bottom], [3, 13, 97, 137]);
  const tight = computeLayout({ ...mm10x15, ...p5x7, gap: 0, margin: 0 });
  assert.deepEqual(cutGuides(tight.cells), { xs: [0, 50, 100], ys: [5, 75, 145], left: 0, top: 5, right: 100, bottom: 145 });
  // última linha incompleta: a caixa ainda cobre as colunas usadas
  const partial = computeLayout({ ...mm10x15, ...p3x4, gap: 2, margin: 2, maxCount: 4 });
  const pg = cutGuides(partial.cells);
  assert.deepEqual([pg.left, pg.top, pg.right, pg.bottom], [3, 34, 97, 116]);
  assert.deepEqual(cutGuides([]), { xs: [], ys: [], left: 0, top: 0, right: 0, bottom: 0 });
});

test('checkLayout acusa sobreposição e invasão da margem', () => {
  const bad = { cells: [{ x: 0, y: 0, w: 30, h: 40 }, { x: 29, y: 0, w: 30, h: 40 }] };
  const problems = checkLayout(bad, { sheetW: 100, sheetH: 150, gap: 0, margin: 2 });
  assert.ok(problems.includes('foto 1 fora da área útil'));
  assert.ok(problems.includes('fotos 1 e 2 muito próximas'));
});

test('parâmetros inválidos geram erro', () => {
  assert.throws(() => computeLayout({ ...mm10x15, photoW: 0, photoH: 40 }), RangeError);
  assert.throws(() => computeLayout({ ...mm10x15, ...p3x4, gap: -1 }), RangeError);
  assert.throws(() => computeLayout({ ...mm10x15, ...p3x4, margin: NaN }), RangeError);
});

test('varredura: em qualquer combinação a grade é válida e máxima', () => {
  for (const gap of [0, 0.5, 1, 2, 3, 5]) {
    for (const margin of [0, 1, 2, 5, 10]) {
      for (const [sheet, photo] of [[mm10x15, p3x4], [mm10x15, p5x7], [mmA4, p3x4], [mmA4, p5x7]]) {
        const params = { ...sheet, ...photo, gap, margin };
        const l = computeLayout(params);
        assert.deepEqual(checkLayout(l, params), [], JSON.stringify(params));
        // mais uma coluna ou mais uma linha não caberia
        const usedW = (l.cols + 1) * l.cellW + l.cols * gap;
        const usedH = (l.rows + 1) * l.cellH + l.rows * gap;
        assert.ok(usedW > sheet.sheetW - 2 * margin + 1e-9, 'coluna extra caberia');
        assert.ok(usedH > sheet.sheetH - 2 * margin + 1e-9, 'linha extra caberia');
      }
    }
  }
});
