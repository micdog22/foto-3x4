// Interface da Foto 3x4: abrir a foto, enquadrar, montar a folha, baixar e imprimir.
// A matemática (unidades, grade, recorte e cabeçalho JFIF) fica nos módulos puros.

import { PHOTOS, PAPERS, mmToPx, sizeInPx, formatMm } from './units.js';
import { computeLayout, cutGuides, suggestTighter } from './layout.js';
import {
  createCrop, clampCrop, cropMatrix, cropScale, panCrop, zoomCropAt, rotateCrop, mipLevel, faceGuides, MAX_ZOOM,
} from './crop.js';
import { setJpegDpi } from './jfif.js';

const DPI = 300;
const CONTEXT = 0.12; // faixa de contexto em volta do quadro, em fração da largura do quadro
const LINE_MM = 0.25; // espessura visível da linha de corte
const LINE_COLOR = '#a3a9b1';
const LINE_EXTEND_MM = 6; // quanto as linhas de corte passam além do bloco de fotos
const SETTINGS_KEY = 'foto-3x4:ajustes';

const $ = (id) => document.getElementById(id);
const els = {
  dropzone: $('dropzone'), fileInput: $('file-input'), sample: $('sample'), openStatus: $('open-status'),
  cropCard: $('crop-card'), sheetCard: $('sheet-card'), exportCard: $('export-card'),
  cropCanvas: $('crop-canvas'), zoom: $('zoom'), zoomLabel: $('zoom-label'), angle: $('angle'), angleLabel: $('angle-label'),
  rotateLeft: $('rotate-left'), rotateRight: $('rotate-right'), resetCrop: $('reset-crop'), showGuides: $('show-guides'),
  photoInfo: $('photo-info'), gap: $('gap'), margin: $('margin'), count: $('count'), cutLines: $('cut-lines'),
  summary: $('sheet-summary'), hint: $('sheet-hint'), hintText: $('sheet-hint-text'), applyHint: $('apply-hint'),
  sheetCanvas: $('sheet-canvas'), sheetCaption: $('sheet-caption'), downloadSheet: $('download-sheet'),
  downloadPhoto: $('download-photo'), print: $('print'), exportStatus: $('export-status'), printRoot: $('print-root'),
  page10x15: $('page-10x15'), pageA4: $('page-a4'),
};

const state = {
  image: null, imageUrl: null, fileName: 'foto', mips: [],
  crop: null, quarter: 0, fine: 0,
  photo: '3x4', paper: '10x15', gap: 2, margin: 2, count: 0, cutLines: true, guides: true,
  drag: null, pointers: new Map(), queued: false, hint: null, capacity: -1,
  photoCanvas: document.createElement('canvas'),
};

const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setStatus(target, message, kind = '') {
  target.textContent = message;
  target.className = `status${kind ? ` ${kind}` : ''}`;
}

// ---------- ajustes salvos ----------

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (PHOTOS[saved.photo]) state.photo = saved.photo;
    if (PAPERS[saved.paper]) state.paper = saved.paper;
    if (Number.isFinite(saved.gap)) state.gap = Math.min(10, Math.max(0, saved.gap));
    if (Number.isFinite(saved.margin)) state.margin = Math.min(20, Math.max(0, saved.margin));
    if (typeof saved.cutLines === 'boolean') state.cutLines = saved.cutLines;
    if (typeof saved.guides === 'boolean') state.guides = saved.guides;
  } catch {
    // armazenamento indisponível (modo privado, cota): segue com o padrão
  }
}

function saveSettings() {
  try {
    const { photo, paper, gap, margin, cutLines, guides } = state;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ photo, paper, gap, margin, cutLines, guides }));
  } catch {
    // sem armazenamento: os ajustes valem só nesta visita
  }
}

// ---------- abrir a foto ----------

async function loadFile(file, name) {
  if (!file || !(/^image\//.test(file.type) || /\.(jpe?g|png|webp|gif|bmp|heic|avif)$/i.test(file.name || ''))) {
    setStatus(els.openStatus, 'Esse arquivo não parece ser uma foto.', 'error');
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    const heic = /\.heic$/i.test(file.name || '') || /heic|heif/i.test(file.type);
    setStatus(els.openStatus, heic
      ? 'Este navegador não abre fotos HEIC. No iPhone, use Ajustes > Câmera > Formatos > Mais Compatível, ou abra a página no Safari.'
      : 'Não foi possível abrir essa foto. Tente um JPEG ou PNG.', 'error');
    return;
  }
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  state.image = img;
  state.imageUrl = url;
  state.fileName = name || file.name || 'foto';
  state.mips = [img];
  state.quarter = 0;
  state.fine = 0;
  state.crop = clampCrop(createCrop(img.naturalWidth, img.naturalHeight), ...outDims());
  els.cropCard.hidden = false;
  els.sheetCard.hidden = false;
  els.exportCard.hidden = false;
  setStatus(els.openStatus, `Foto aberta: ${img.naturalWidth} x ${img.naturalHeight} pixels. Agora enquadre o rosto.`, 'ok');
  syncControls();
  scheduleRender();
  els.cropCard.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

// Foto de exemplo: uma ilustração simples de pessoa, fora do centro, para treinar o recorte.
function makeSample() {
  const c = document.createElement('canvas');
  c.width = 1500;
  c.height = 1200;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 1200);
  sky.addColorStop(0, '#e9eef3');
  sky.addColorStop(1, '#d5dde6');
  g.fillStyle = sky;
  g.fillRect(0, 0, 1500, 1200);
  const cx = 860;
  g.fillStyle = '#2f4a6d'; // camisa
  g.beginPath();
  g.moveTo(cx - 330, 1200);
  g.bezierCurveTo(cx - 320, 930, cx - 200, 870, cx, 860);
  g.bezierCurveTo(cx + 200, 870, cx + 320, 930, cx + 330, 1200);
  g.fill();
  g.fillStyle = '#c99772'; // pescoço
  g.fillRect(cx - 62, 690, 124, 190);
  g.beginPath(); // rosto
  g.ellipse(cx, 560, 165, 210, 0, 0, Math.PI * 2);
  g.fillStyle = '#e0ad86';
  g.fill();
  g.fillStyle = '#3b2a20'; // cabelo
  g.beginPath();
  g.ellipse(cx, 430, 182, 128, 0, Math.PI, Math.PI * 2);
  g.fill();
  g.fillRect(cx - 182, 425, 40, 120);
  g.fillRect(cx + 142, 425, 40, 120);
  g.fillStyle = '#2b2b2b'; // olhos
  for (const dx of [-62, 62]) {
    g.beginPath();
    g.ellipse(cx + dx, 545, 16, 11, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#3b2a20';
  g.lineWidth = 9;
  g.lineCap = 'round';
  for (const dx of [-62, 62]) {
    g.beginPath();
    g.moveTo(cx + dx - 34, 505);
    g.lineTo(cx + dx + 34, 503);
    g.stroke();
  }
  g.strokeStyle = '#b5835f'; // nariz e boca
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(cx, 560);
  g.quadraticCurveTo(cx - 16, 620, cx + 6, 630);
  g.stroke();
  g.strokeStyle = '#9c4f45';
  g.beginPath();
  g.moveTo(cx - 52, 680);
  g.quadraticCurveTo(cx, 702, cx + 52, 680);
  g.stroke();
  return new Promise((resolve) => c.toBlob((b) => resolve(new File([b], 'exemplo.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.92));
}

// ---------- desenho do recorte ----------

function outDims() {
  const { w, h } = sizeInPx(PHOTOS[state.photo], DPI);
  return [w, h];
}

// Pirâmide de reduções pela metade, criada sob demanda (ver mipLevel em crop.js).
function mip(level) {
  while (state.mips.length <= level) {
    const prev = state.mips[state.mips.length - 1];
    const pw = prev.naturalWidth || prev.width;
    const ph = prev.naturalHeight || prev.height;
    if (pw < 2 || ph < 2) break;
    const next = document.createElement('canvas');
    next.width = Math.ceil(pw / 2);
    next.height = Math.ceil(ph / 2);
    const g = next.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(prev, 0, 0, next.width, next.height);
    state.mips.push(next);
  }
  return state.mips[Math.min(level, state.mips.length - 1)];
}

/**
 * Desenha o recorte num contexto 2D. `k` converte pixels de saída em pixels do canvas
 * e (ox, oy) desloca o resultado. A matriz do recorte é ajustada para a redução usada.
 */
function drawCropped(g, k = 1, ox = 0, oy = 0) {
  const [outW, outH] = outDims();
  const crop = state.crop;
  const src = mip(mipLevel(cropScale(crop, outW, outH) * k));
  const kx = (src.naturalWidth || src.width) / crop.imgW;
  const ky = (src.naturalHeight || src.height) / crop.imgH;
  const [a, b, c, d, e, f] = cropMatrix(crop, outW, outH);
  g.save();
  g.setTransform((k * a) / kx, (k * b) / kx, (k * c) / ky, (k * d) / ky, k * e + ox, k * f + oy);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0);
  g.restore();
}

function stageMetrics() {
  const [outW, outH] = outDims();
  const cssW = els.cropCanvas.clientWidth || 300;
  const frame = cssW / (1 + 2 * CONTEXT);
  const k = frame / outW; // pixels CSS por pixel de saída
  const off = CONTEXT * frame;
  return { outW, outH, cssW, cssH: outH * k + 2 * off, k, off };
}

function cssVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function drawStage() {
  const canvas = els.cropCanvas;
  const m = stageMetrics();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(m.cssW * dpr);
  canvas.height = Math.round(m.cssH * dpr);
  const g = canvas.getContext('2d');
  g.fillStyle = cssVar('--surface-2', '#f0f2f5');
  g.fillRect(0, 0, canvas.width, canvas.height);
  if (!state.crop) return;
  const k = m.k * dpr;
  const off = m.off * dpr;
  drawCropped(g, k, off, off);

  const fw = m.outW * k;
  const fh = m.outH * k;
  g.save();
  g.fillStyle = 'rgba(15, 17, 21, 0.6)';
  g.beginPath();
  g.rect(0, 0, canvas.width, canvas.height);
  g.rect(off, off, fw, fh);
  g.fill('evenodd');
  g.lineWidth = 2 * dpr;
  g.strokeStyle = '#ffffff';
  g.strokeRect(off, off, fw, fh);
  g.restore();

  if (state.guides) drawGuides(g, off, off, fw, fh, dpr);
}

function drawGuides(g, x, y, w, h, dpr) {
  const gd = faceGuides(state.photo);
  const ovalCy = y + ((gd.top + gd.chin) / 2) * h;
  const ry = ((gd.chin - gd.top) / 2) * h;
  const rx = gd.halfWidth * w;
  const stroke = (color, width, dash) => {
    g.strokeStyle = color;
    g.lineWidth = width * dpr;
    g.setLineDash(dash.map((v) => v * dpr));
    g.beginPath();
    g.ellipse(x + w / 2, ovalCy, rx, ry, 0, 0, Math.PI * 2);
    g.moveTo(x + w / 2, y);
    g.lineTo(x + w / 2, y + h);
    g.moveTo(x + w * 0.2, y + gd.eyes * h);
    g.lineTo(x + w * 0.8, y + gd.eyes * h);
    g.moveTo(x + w * 0.3, y + gd.top * h);
    g.lineTo(x + w * 0.7, y + gd.top * h);
    g.moveTo(x + w * 0.3, y + gd.chin * h);
    g.lineTo(x + w * 0.7, y + gd.chin * h);
    g.stroke();
  };
  g.save();
  stroke('rgba(0, 0, 0, 0.45)', 3, []);
  stroke('rgba(255, 255, 255, 0.95)', 1.5, [6, 5]);
  g.setLineDash([]);
  g.font = `600 ${11 * dpr}px system-ui, sans-serif`;
  g.fillStyle = '#ffffff';
  g.shadowColor = 'rgba(0, 0, 0, 0.7)';
  g.shadowBlur = 3 * dpr;
  g.fillText('olhos', x + w * 0.8 + 4 * dpr, y + gd.eyes * h + 4 * dpr);
  g.fillText('topo', x + w * 0.7 + 4 * dpr, y + gd.top * h + 4 * dpr);
  g.fillText('queixo', x + w * 0.7 + 4 * dpr, y + gd.chin * h + 4 * dpr);
  g.restore();
}

function renderPhoto() {
  const [outW, outH] = outDims();
  const c = state.photoCanvas;
  c.width = outW;
  c.height = outH;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, outW, outH);
  drawCropped(g, 1);
}

// ---------- folha ----------

function layoutMm(maxCount = state.count || Infinity) {
  const photo = PHOTOS[state.photo];
  const paper = PAPERS[state.paper];
  return computeLayout({
    sheetW: paper.w, sheetH: paper.h, photoW: photo.w, photoH: photo.h, gap: state.gap, margin: state.margin, maxCount,
  });
}

// Linhas de corte cobrem o bloco de fotos e passam um pouco além dele, sem sair da folha.
function lineSpan(layout) {
  const paper = PAPERS[state.paper];
  const g = cutGuides(layout.cells);
  return {
    xs: g.xs, ys: g.ys,
    x0: Math.max(0, g.left - LINE_EXTEND_MM), x1: Math.min(paper.w, g.right + LINE_EXTEND_MM),
    y0: Math.max(0, g.top - LINE_EXTEND_MM), y1: Math.min(paper.h, g.bottom + LINE_EXTEND_MM),
  };
}

/**
 * Desenha a folha num canvas com `pxPerMm` pixels por milímetro: fundo branco, linhas de
 * corte atravessando a folha e as fotos por cima (as linhas só aparecem nos espaços).
 */
function drawSheet(g, layout, pxPerMm, native = false) {
  const paper = PAPERS[state.paper];
  const W = Math.round(paper.w * pxPerMm);
  const H = Math.round(paper.h * pxPerMm);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  const P = (mm) => Math.round(mm * pxPerMm);
  if (state.cutLines && layout.count) {
    const span = lineSpan(layout);
    const half = Math.max(1, Math.round(LINE_MM * pxPerMm));
    g.fillStyle = LINE_COLOR;
    for (const x of span.xs) g.fillRect(P(x) - half, P(span.y0), 2 * half, P(span.y1) - P(span.y0));
    for (const y of span.ys) g.fillRect(P(span.x0), P(y) - half, P(span.x1) - P(span.x0), 2 * half);
  }
  const photo = state.photoCanvas;
  for (const cell of layout.cells) {
    const x = P(cell.x);
    const y = P(cell.y);
    // no arquivo final cada foto sai no tamanho exato (354 x 472 no 3x4), sem reamostrar
    const w = native ? (cell.rotated ? photo.height : photo.width) : P(cell.x + cell.w) - x;
    const h = native ? (cell.rotated ? photo.width : photo.height) : P(cell.y + cell.h) - y;
    if (cell.rotated) {
      g.save();
      g.translate(x + w, y);
      g.rotate(Math.PI / 2);
      g.drawImage(photo, 0, 0, h, w);
      g.restore();
    } else {
      g.drawImage(photo, x, y, w, h);
    }
  }
}

function renderSheetPreview(layout) {
  const paper = PAPERS[state.paper];
  const canvas = els.sheetCanvas;
  const cssW = canvas.clientWidth || 260;
  const dpr = window.devicePixelRatio || 1;
  const pxPerMm = (cssW * dpr) / paper.w;
  canvas.width = Math.round(paper.w * pxPerMm);
  canvas.height = Math.round(paper.h * pxPerMm);
  const g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'high';
  drawSheet(g, layout, pxPerMm);
  els.sheetCaption.textContent = `Prévia da folha ${PAPERS[state.paper].name}`;
}

function updateCountOptions(capacity) {
  if (capacity === state.capacity) {
    els.count.value = String(state.count);
    return;
  }
  state.capacity = capacity;
  const current = state.count;
  const options = [el('option', '', `Todas que cabem (${capacity})`)];
  options[0].value = '0';
  for (let n = 1; n < capacity; n++) {
    const o = el('option', '', String(n));
    o.value = String(n);
    options.push(o);
  }
  els.count.replaceChildren(...options);
  state.count = current > 0 && current < capacity ? current : 0;
  els.count.value = String(state.count);
}

function updateSheetTexts(layout) {
  const photo = PHOTOS[state.photo];
  const paper = PAPERS[state.paper];
  const { w, h } = sizeInPx(paper, DPI);
  if (!layout.count) {
    els.summary.textContent = 'Nenhuma foto cabe com essas medidas. Diminua o espaço entre as fotos ou a margem.';
  } else {
    const plural = layout.count === 1 ? 'foto' : 'fotos';
    const turned = layout.rotated ? ' As fotos ficam deitadas na folha para caber mais.' : '';
    els.summary.textContent = `${layout.count} ${plural} ${photo.name} na folha ${paper.name}. `
      + `Arquivo de ${w} x ${h} pixels a ${DPI} dpi.${turned}`;
  }
  const hint = suggestTighter({ sheetW: paper.w, sheetH: paper.h, photoW: photo.w, photoH: photo.h, gap: state.gap, margin: state.margin });
  state.hint = hint;
  els.hint.hidden = !hint;
  if (hint) {
    els.hintText.textContent = hint.margin === state.margin
      ? `Com espaço 0 (fotos encostadas), cabem ${hint.capacity}.`
      : `Com espaço 0 e margem 0, cabem ${hint.capacity}. A impressão rente à borda pode cortar um pouco das fotos de fora.`;
  }
  const disabled = !layout.count;
  els.downloadSheet.disabled = disabled;
  els.print.disabled = disabled;
}

function updatePhotoInfo() {
  const [outW, outH] = outDims();
  const s = cropScale(state.crop, outW, outH);
  const sourceDpi = DPI / s; // pixels da foto original por polegada impressa
  let quality;
  if (sourceDpi >= 280) quality = 'boa';
  else if (sourceDpi >= 150) quality = 'razoável (a foto será um pouco ampliada)';
  else quality = 'baixa: a foto original tem poucos pixels para esse zoom e pode sair borrada';
  els.photoInfo.textContent = `Foto final: ${outW} x ${outH} pixels (${PHOTOS[state.photo].name} a ${DPI} dpi). `
    + `Qualidade ${quality} (equivale a ${nf0.format(sourceDpi)} dpi).`;
}

function syncControls() {
  if (!state.crop) return;
  els.zoom.value = String(Math.round(state.crop.zoom * 100));
  els.zoomLabel.textContent = `${Math.round(state.crop.zoom * 100)}%`;
  els.angle.value = String(state.fine);
  els.angleLabel.textContent = `${formatMm(state.fine)}°`;
}

function scheduleRender() {
  if (state.queued) return;
  state.queued = true;
  requestAnimationFrame(() => {
    state.queued = false;
    renderAll();
  });
}

function renderAll() {
  const layout = layoutMm(Infinity);
  updateCountOptions(layout.capacity);
  const used = layoutMm();
  updateSheetTexts(used);
  if (!state.crop) return;
  drawStage();
  renderPhoto();
  renderSheetPreview(used);
  updatePhotoInfo();
}

function setCrop(crop) {
  state.crop = crop;
  syncControls();
  scheduleRender();
}

// ---------- interação com o recorte ----------

function toOutput(e) {
  const r = els.cropCanvas.getBoundingClientRect();
  const m = stageMetrics();
  const scale = m.cssW / r.width; // caso o canvas esteja esticado
  return { x: ((e.clientX - r.left) * scale - m.off) / m.k, y: ((e.clientY - r.top) * scale - m.off) / m.k };
}

function onPointerDown(e) {
  if (!state.crop) return;
  els.cropCanvas.focus({ preventScroll: true });
  try { els.cropCanvas.setPointerCapture(e.pointerId); } catch { /* ponteiro já liberado */ }
  state.pointers.set(e.pointerId, toOutput(e));
  if (state.pointers.size === 2) {
    const [a0, b0] = [...state.pointers.values()];
    state.drag = { kind: 'pinch', start: state.crop, a0, b0, ids: [...state.pointers.keys()] };
  } else if (state.pointers.size === 1) {
    state.drag = { kind: 'pan', last: toOutput(e) };
    els.cropCanvas.classList.add('grabbing');
  }
  e.preventDefault();
}

function onPointerMove(e) {
  if (!state.pointers.has(e.pointerId) || !state.drag) return;
  const p = toOutput(e);
  state.pointers.set(e.pointerId, p);
  const [outW, outH] = outDims();
  const d = state.drag;
  if (d.kind === 'pan') {
    setCrop(panCrop(state.crop, outW, outH, p.x - d.last.x, p.y - d.last.y));
    d.last = p;
  } else if (d.kind === 'pinch') {
    const a1 = state.pointers.get(d.ids[0]);
    const b1 = state.pointers.get(d.ids[1]);
    if (!a1 || !b1) return;
    const d0 = Math.hypot(d.b0.x - d.a0.x, d.b0.y - d.a0.y) || 1;
    const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y) || d0;
    const m0 = { x: (d.a0.x + d.b0.x) / 2, y: (d.a0.y + d.b0.y) / 2 };
    const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
    const zoomed = zoomCropAt(d.start, outW, outH, d.start.zoom * (d1 / d0), m0.x, m0.y);
    setCrop(panCrop(zoomed, outW, outH, m1.x - m0.x, m1.y - m0.y));
  }
}

function onPointerUp(e) {
  state.pointers.delete(e.pointerId);
  if (state.pointers.size === 0) {
    state.drag = null;
    els.cropCanvas.classList.remove('grabbing');
  } else if (state.drag && state.drag.kind === 'pinch') {
    state.drag = null; // um dedo ficou: espera soltar tudo
  }
}

function onWheel(e) {
  if (!state.crop) return;
  e.preventDefault();
  const [outW, outH] = outDims();
  const q = toOutput(e);
  const unit = e.deltaMode === 1 ? 0.05 : 0.0015;
  setCrop(zoomCropAt(state.crop, outW, outH, state.crop.zoom * Math.exp(-e.deltaY * unit), q.x, q.y));
}

function onCropKey(e) {
  if (!state.crop || e.altKey || e.ctrlKey || e.metaKey) return;
  const [outW, outH] = outDims();
  const step = e.shiftKey ? 20 : 2;
  let next = null;
  switch (e.key) {
    case 'ArrowLeft': next = panCrop(state.crop, outW, outH, -step, 0); break;
    case 'ArrowRight': next = panCrop(state.crop, outW, outH, step, 0); break;
    case 'ArrowUp': next = panCrop(state.crop, outW, outH, 0, -step); break;
    case 'ArrowDown': next = panCrop(state.crop, outW, outH, 0, step); break;
    case '+': case '=': next = zoomCropAt(state.crop, outW, outH, state.crop.zoom * 1.05); break;
    case '-': case '_': next = zoomCropAt(state.crop, outW, outH, state.crop.zoom / 1.05); break;
    case '[': case ']': {
      const delta = (e.key === ']' ? 1 : -1) * (e.shiftKey ? 5 : 0.5);
      state.fine = Math.max(-45, Math.min(45, state.fine + delta));
      next = rotateCrop(state.crop, outW, outH, state.quarter * 90 + state.fine);
      break;
    }
    default: return;
  }
  e.preventDefault();
  setCrop(next);
}

function rotateQuarter(dir) {
  if (!state.crop) return;
  state.quarter = (state.quarter + dir + 4) % 4;
  const [outW, outH] = outDims();
  setCrop(rotateCrop({ ...state.crop, zoom: 1 }, outW, outH, state.quarter * 90 + state.fine));
}

function resetCrop() {
  if (!state.image) return;
  state.quarter = 0;
  state.fine = 0;
  setCrop(clampCrop(createCrop(state.image.naturalWidth, state.image.naturalHeight), ...outDims()));
}

// ---------- exportação e impressão ----------

function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('o navegador não conseguiu gerar o JPEG'));
        return;
      }
      const { bytes } = setJpegDpi(new Uint8Array(await blob.arrayBuffer()), DPI);
      resolve(new Blob([bytes], { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.95);
  });
}

function download(blob, name) {
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

async function exportSheet() {
  const layout = layoutMm();
  if (!state.crop || !layout.count) return;
  renderPhoto();
  const paper = PAPERS[state.paper];
  const canvas = document.createElement('canvas');
  const pxPerMm = DPI / 25.4;
  canvas.width = mmToPx(paper.w, DPI);
  canvas.height = mmToPx(paper.h, DPI);
  const g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'high';
  drawSheet(g, layout, pxPerMm, true);
  try {
    const blob = await canvasToJpeg(canvas);
    const name = `fotos-${state.photo}-${state.paper}.jpg`;
    download(blob, name);
    setStatus(els.exportStatus, `Folha salva: ${name} (${canvas.width} x ${canvas.height} pixels, ${DPI} dpi, ${layout.count} fotos).`, 'ok');
  } catch (err) {
    setStatus(els.exportStatus, `Não foi possível gerar o arquivo: ${err.message}.`, 'error');
  }
}

async function exportPhoto() {
  if (!state.crop) return;
  renderPhoto();
  try {
    const blob = await canvasToJpeg(state.photoCanvas);
    const name = `foto-${state.photo}.jpg`;
    download(blob, name);
    setStatus(els.exportStatus, `Foto salva: ${name} (${state.photoCanvas.width} x ${state.photoCanvas.height} pixels, ${DPI} dpi).`, 'ok');
  } catch (err) {
    setStatus(els.exportStatus, `Não foi possível gerar o arquivo: ${err.message}.`, 'error');
  }
}

function rotatedCopy(src) {
  const c = document.createElement('canvas');
  c.width = src.height;
  c.height = src.width;
  const g = c.getContext('2d');
  g.translate(c.width, 0);
  g.rotate(Math.PI / 2);
  g.drawImage(src, 0, 0);
  return c;
}

function selectPageSize() {
  els.page10x15.disabled = state.paper !== '10x15';
  els.pageA4.disabled = state.paper !== 'a4';
}

async function printSheet() {
  const layout = layoutMm();
  if (!state.crop || !layout.count) return;
  renderPhoto();
  selectPageSize();
  const paper = PAPERS[state.paper];
  const sheet = el('div', 'print-sheet');
  sheet.style.width = `${paper.w}mm`;
  sheet.style.height = `${paper.h}mm`;
  if (state.cutLines) {
    const span = lineSpan(layout);
    for (const x of span.xs) {
      const line = el('div', 'print-line');
      Object.assign(line.style, { left: `${x - LINE_MM}mm`, top: `${span.y0}mm`, width: `${2 * LINE_MM}mm`, height: `${span.y1 - span.y0}mm` });
      sheet.append(line);
    }
    for (const y of span.ys) {
      const line = el('div', 'print-line');
      Object.assign(line.style, { left: `${span.x0}mm`, top: `${y - LINE_MM}mm`, width: `${span.x1 - span.x0}mm`, height: `${2 * LINE_MM}mm` });
      sheet.append(line);
    }
  }
  const source = layout.rotated ? rotatedCopy(state.photoCanvas) : state.photoCanvas;
  const dataUrl = source.toDataURL('image/jpeg', 0.95);
  const images = layout.cells.map((cell) => {
    const img = el('img');
    img.alt = '';
    img.src = dataUrl;
    Object.assign(img.style, { left: `${cell.x}mm`, top: `${cell.y}mm`, width: `${cell.w}mm`, height: `${cell.h}mm` });
    sheet.append(img);
    return img;
  });
  els.printRoot.replaceChildren(sheet);
  await Promise.all(images.map((img) => img.decode().catch(() => null)));
  window.print();
}

// ---------- colar e arrastar ----------

function bindFileSources() {
  els.fileInput.addEventListener('change', () => loadFile(els.fileInput.files[0]));
  els.sample.addEventListener('click', async () => loadFile(await makeSample(), 'exemplo.jpg'));
  document.addEventListener('paste', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type === 'number') return;
    const item = Array.from((e.clipboardData && e.clipboardData.items) || []).find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    loadFile(item.getAsFile(), 'foto-colada.png');
  });
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  document.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; document.body.classList.add('dragging'); } });
  document.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove('dragging');
  });
  document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging');
    loadFile(Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/')) || e.dataTransfer.files[0]);
  });
}

// ---------- inicialização ----------

function readNumber(input, min, max, fallback) {
  const v = Number(String(input.value).replace(',', '.'));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function onSettingsChange() {
  saveSettings();
  if (state.crop) {
    state.crop = clampCrop(state.crop, ...outDims());
    syncControls();
  }
  scheduleRender();
}

function init() {
  loadSettings();
  document.querySelector(`input[name="photo"][value="${state.photo}"]`).checked = true;
  document.querySelector(`input[name="paper"][value="${state.paper}"]`).checked = true;
  els.gap.value = String(state.gap);
  els.margin.value = String(state.margin);
  els.cutLines.checked = state.cutLines;
  els.showGuides.checked = state.guides;
  selectPageSize();

  bindFileSources();
  document.querySelectorAll('input[name="photo"]').forEach((r) => r.addEventListener('change', () => {
    state.photo = r.value;
    onSettingsChange();
  }));
  document.querySelectorAll('input[name="paper"]').forEach((r) => r.addEventListener('change', () => {
    state.paper = r.value;
    state.margin = PAPERS[r.value].margin;
    els.margin.value = String(state.margin);
    state.count = 0;
    selectPageSize();
    onSettingsChange();
  }));
  els.gap.addEventListener('input', () => { state.gap = readNumber(els.gap, 0, 10, state.gap); onSettingsChange(); });
  els.margin.addEventListener('input', () => { state.margin = readNumber(els.margin, 0, 20, state.margin); onSettingsChange(); });
  els.count.addEventListener('change', () => { state.count = Number(els.count.value) || 0; scheduleRender(); });
  els.cutLines.addEventListener('change', () => { state.cutLines = els.cutLines.checked; onSettingsChange(); });
  els.showGuides.addEventListener('change', () => { state.guides = els.showGuides.checked; onSettingsChange(); });
  els.applyHint.addEventListener('click', () => {
    if (!state.hint) return;
    state.gap = state.hint.gap;
    state.margin = state.hint.margin;
    els.gap.value = String(state.gap);
    els.margin.value = String(state.margin);
    state.count = 0;
    onSettingsChange();
  });

  els.zoom.addEventListener('input', () => {
    if (!state.crop) return;
    const [outW, outH] = outDims();
    setCrop(zoomCropAt(state.crop, outW, outH, Number(els.zoom.value) / 100));
  });
  els.zoom.max = String(MAX_ZOOM * 100);
  els.angle.addEventListener('input', () => {
    if (!state.crop) return;
    state.fine = Number(els.angle.value);
    const [outW, outH] = outDims();
    setCrop(rotateCrop(state.crop, outW, outH, state.quarter * 90 + state.fine));
  });
  els.rotateLeft.addEventListener('click', () => rotateQuarter(-1));
  els.rotateRight.addEventListener('click', () => rotateQuarter(1));
  els.resetCrop.addEventListener('click', resetCrop);

  const cv = els.cropCanvas;
  cv.addEventListener('pointerdown', onPointerDown);
  cv.addEventListener('pointermove', onPointerMove);
  cv.addEventListener('pointerup', onPointerUp);
  cv.addEventListener('pointercancel', onPointerUp);
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('keydown', onCropKey);

  els.downloadSheet.addEventListener('click', exportSheet);
  els.downloadPhoto.addEventListener('click', exportPhoto);
  els.print.addEventListener('click', printSheet);

  new ResizeObserver(() => scheduleRender()).observe(els.cropCanvas.parentElement);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', scheduleRender);
  renderAll();
  setStatus(els.openStatus, 'Pronto. Escolha, arraste ou cole uma foto para começar.');
}

init();
