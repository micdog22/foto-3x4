// Montagem da folha: quantas fotos cabem, onde cada uma fica e onde passam as linhas de corte.
//
// As funções não sabem de unidade: funcionam em milímetros (para a impressão com CSS)
// ou em pixels (para o JPEG), desde que tudo esteja na mesma unidade.

const EPS = 1e-9;

/**
 * Quantas células de `cell` cabem em `avail`, com `gap` entre elas.
 * n células ocupam n * cell + (n - 1) * gap, então n <= (avail + gap) / (cell + gap).
 */
export function fitCount(avail, cell, gap) {
  if (!(cell > 0) || avail + EPS < cell) return 0;
  return Math.floor((avail + gap + EPS) / (cell + gap));
}

function validate(params) {
  const { sheetW, sheetH, photoW, photoH, gap, margin } = params;
  for (const [name, v] of Object.entries({ sheetW, sheetH, photoW, photoH })) {
    if (!Number.isFinite(v) || v <= 0) throw new RangeError(`${name} precisa ser um número positivo`);
  }
  for (const [name, v] of Object.entries({ gap, margin })) {
    if (!Number.isFinite(v) || v < 0) throw new RangeError(`${name} precisa ser zero ou positivo`);
  }
}

/**
 * Calcula a grade de fotos numa folha.
 *
 * Tenta a foto em pé e deitada (girada 90 graus) e fica com a orientação que cabe mais
 * fotos; no empate, em pé. As fotos usadas formam um bloco centralizado na folha.
 *
 * Parâmetros: sheetW, sheetH, photoW, photoH, gap (espaço entre fotos), margin (margem
 * mínima até a borda), maxCount (limite opcional), allowRotate e integer (posições
 * inteiras, para pixels).
 */
export function computeLayout({
  sheetW, sheetH, photoW, photoH, gap = 0, margin = 0, maxCount = Infinity, allowRotate = true, integer = false,
}) {
  validate({ sheetW, sheetH, photoW, photoH, gap, margin });
  const availW = sheetW - 2 * margin;
  const availH = sheetH - 2 * margin;
  const upright = { cols: fitCount(availW, photoW, gap), rows: fitCount(availH, photoH, gap), rotated: false };
  const turned = allowRotate
    ? { cols: fitCount(availW, photoH, gap), rows: fitCount(availH, photoW, gap), rotated: true }
    : { cols: 0, rows: 0, rotated: true };
  const best = turned.cols * turned.rows > upright.cols * upright.rows ? turned : upright;
  const cellW = best.rotated ? photoH : photoW;
  const cellH = best.rotated ? photoW : photoH;
  const capacity = best.cols * best.rows;
  const limit = Number.isFinite(maxCount) ? Math.max(0, Math.floor(maxCount)) : capacity;
  const count = Math.min(capacity, limit);

  const usedCols = Math.min(best.cols, count);
  const usedRows = count > 0 ? Math.ceil(count / best.cols) : 0;
  const gridW = usedCols * cellW + Math.max(0, usedCols - 1) * gap;
  const gridH = usedRows * cellH + Math.max(0, usedRows - 1) * gap;
  let x0 = (sheetW - gridW) / 2;
  let y0 = (sheetH - gridH) / 2;
  if (integer) {
    x0 = Math.floor(x0);
    y0 = Math.floor(y0);
  }
  const cells = [];
  for (let i = 0; i < count; i++) {
    const col = i % best.cols;
    const row = Math.floor(i / best.cols);
    cells.push({ x: x0 + col * (cellW + gap), y: y0 + row * (cellH + gap), w: cellW, h: cellH, rotated: best.rotated });
  }
  return { cols: best.cols, rows: best.rows, capacity, count, rotated: best.rotated, cellW, cellH, gridW, gridH, x0, y0, cells };
}

/**
 * Linhas de corte: todas as bordas verticais (xs) e horizontais (ys) das fotos, sem
 * repetição e em ordem, mais a caixa que envolve o bloco de fotos (left, top, right,
 * bottom). O app desenha cada linha por baixo das fotos, cobrindo o bloco e um pouco
 * além dele, então ela só aparece nos espaços e nas margens, como marcas de corte.
 */
export function cutGuides(cells) {
  const xs = new Set();
  const ys = new Set();
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const c of cells) {
    xs.add(c.x);
    xs.add(c.x + c.w);
    ys.add(c.y);
    ys.add(c.y + c.h);
    left = Math.min(left, c.x);
    top = Math.min(top, c.y);
    right = Math.max(right, c.x + c.w);
    bottom = Math.max(bottom, c.y + c.h);
  }
  const byNumber = (a, b) => a - b;
  if (!cells.length) return { xs: [], ys: [], left: 0, top: 0, right: 0, bottom: 0 };
  return { xs: [...xs].sort(byNumber), ys: [...ys].sort(byNumber), left, top, right, bottom };
}

/**
 * Sugestão para caber mais fotos sem mudar a orientação: tenta zerar o espaço entre as
 * fotos (mantendo a margem) e, se não bastar, zerar também a margem. Devolve
 * { capacity, gap, margin } da primeira opção que aumenta a capacidade, ou null.
 */
export function suggestTighter(params) {
  const current = computeLayout(params);
  const photoW = current.rotated ? params.photoH : params.photoW;
  const photoH = current.rotated ? params.photoW : params.photoH;
  const margin = params.margin ?? 0;
  const options = margin > 0 ? [margin, 0] : [0];
  for (const m of options) {
    if ((params.gap ?? 0) === 0 && m === margin) continue;
    const l = computeLayout({ ...params, photoW, photoH, gap: 0, margin: m, maxCount: Infinity, allowRotate: false });
    if (l.capacity > current.capacity) return { capacity: l.capacity, gap: 0, margin: m };
  }
  return null;
}

/** Confere se as células cabem na folha, respeitam a margem e não se sobrepõem. */
export function checkLayout(layout, { sheetW, sheetH, gap = 0, margin = 0 }) {
  const problems = [];
  const cells = layout.cells;
  cells.forEach((c, i) => {
    if (c.x < margin - EPS || c.y < margin - EPS || c.x + c.w > sheetW - margin + EPS || c.y + c.h > sheetH - margin + EPS) {
      problems.push(`foto ${i + 1} fora da área útil`);
    }
    for (let j = 0; j < i; j++) {
      const d = cells[j];
      const sepX = c.x >= d.x + d.w + gap - EPS || d.x >= c.x + c.w + gap - EPS;
      const sepY = c.y >= d.y + d.h + gap - EPS || d.y >= c.y + c.h + gap - EPS;
      if (!sepX && !sepY) problems.push(`fotos ${j + 1} e ${i + 1} muito próximas`);
    }
  });
  return problems;
}
