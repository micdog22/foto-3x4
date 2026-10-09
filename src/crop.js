// Matemática do recorte: posição, zoom e rotação da foto dentro do quadro 3x4.
//
// O estado guarda o ponto da foto que fica no centro do quadro (cx, cy, em pixels da
// foto), o zoom (1 = o mínimo que ainda cobre o quadro) e a rotação em graus.
// A transformação da foto para o quadro de saída (largura outW, altura outH) é:
//
//   q = R(θ) · (p - c) · s + (outW / 2, outH / 2)
//
// onde R(θ) é a rotação, s a escala (pixels de saída por pixel da foto) e c o centro.
// A regra principal: o quadro precisa ficar sempre coberto pela foto, sem cantos vazios.

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
const DEG = Math.PI / 180;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Ângulo em graus normalizado para o intervalo (-180, 180]. */
export function normalizeDegrees(deg) {
  let d = ((deg % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

/**
 * Menor escala em que a foto (imgW x imgH) cobre o quadro (outW x outH) girado de `angle`
 * radianos. O quadro girado ocupa, nos eixos da foto, uma caixa de
 * (outW|cos| + outH|sin|) por (outW|sin| + outH|cos|), que precisa caber na foto.
 */
export function coverScale(imgW, imgH, outW, outH, angle) {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  return Math.max((outW * c + outH * s) / imgW, (outW * s + outH * c) / imgH);
}

/** Metade da caixa ocupada pelo quadro, em pixels da foto, para a escala dada. */
export function halfExtents(outW, outH, angle, scale) {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  return { ex: (outW * c + outH * s) / (2 * scale), ey: (outW * s + outH * c) / (2 * scale) };
}

/** Recorte inicial: foto centralizada, zoom mínimo, sem rotação. */
export function createCrop(imgW, imgH, rotation = 0) {
  return { imgW, imgH, zoom: 1, rotation: normalizeDegrees(rotation), cx: imgW / 2, cy: imgH / 2 };
}

/** Escala efetiva (pixels de saída por pixel da foto). */
export function cropScale(crop, outW, outH) {
  return coverScale(crop.imgW, crop.imgH, outW, outH, crop.rotation * DEG) * crop.zoom;
}

/**
 * Prende o recorte em valores válidos: zoom entre os limites e centro dentro da faixa
 * em que os quatro cantos do quadro caem dentro da foto. Para um retângulo girado
 * dentro de outro alinhado aos eixos, basta checar a caixa envolvente do girado.
 */
export function clampCrop(crop, outW, outH) {
  const zoom = clamp(Number.isFinite(crop.zoom) ? crop.zoom : 1, MIN_ZOOM, MAX_ZOOM);
  const rotation = normalizeDegrees(Number.isFinite(crop.rotation) ? crop.rotation : 0);
  const next = { ...crop, zoom, rotation };
  const s = cropScale(next, outW, outH);
  const { ex, ey } = halfExtents(outW, outH, rotation * DEG, s);
  const fx = (v) => (ex * 2 >= crop.imgW ? crop.imgW / 2 : clamp(v, ex, crop.imgW - ex));
  const fy = (v) => (ey * 2 >= crop.imgH ? crop.imgH / 2 : clamp(v, ey, crop.imgH - ey));
  next.cx = fx(Number.isFinite(crop.cx) ? crop.cx : crop.imgW / 2);
  next.cy = fy(Number.isFinite(crop.cy) ? crop.cy : crop.imgH / 2);
  return next;
}

/**
 * Matriz afim [a, b, c, d, e, f] no formato do canvas (setTransform) que leva um ponto
 * da foto para o quadro de saída: x' = a·x + c·y + e e y' = b·x + d·y + f.
 */
export function cropMatrix(crop, outW, outH) {
  const s = cropScale(crop, outW, outH);
  const t = crop.rotation * DEG;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return [
    s * cos, s * sin, -s * sin, s * cos,
    outW / 2 - s * (cos * crop.cx - sin * crop.cy),
    outH / 2 - s * (sin * crop.cx + cos * crop.cy),
  ];
}

export function imageToOutput(crop, outW, outH, x, y) {
  const [a, b, c, d, e, f] = cropMatrix(crop, outW, outH);
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

/** Inversa: ponto do quadro de saída para a foto. */
export function outputToImage(crop, outW, outH, qx, qy) {
  const s = cropScale(crop, outW, outH);
  const t = crop.rotation * DEG;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const dx = (qx - outW / 2) / s;
  const dy = (qy - outH / 2) / s;
  return { x: crop.cx + cos * dx + sin * dy, y: crop.cy - sin * dx + cos * dy };
}

/** Os quatro cantos do quadro, em coordenadas da foto. */
export function frameCorners(crop, outW, outH) {
  return [[0, 0], [outW, 0], [outW, outH], [0, outH]].map(([x, y]) => outputToImage(crop, outW, outH, x, y));
}

/**
 * Arrastar a foto: um deslocamento (dqx, dqy) no quadro move o conteúdo junto com o
 * dedo, então o centro anda na direção oposta, desfeita a rotação e a escala.
 */
export function panCrop(crop, outW, outH, dqx, dqy) {
  const s = cropScale(crop, outW, outH);
  const t = crop.rotation * DEG;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const dx = dqx / s;
  const dy = dqy / s;
  return clampCrop({ ...crop, cx: crop.cx - (cos * dx + sin * dy), cy: crop.cy - (-sin * dx + cos * dy) }, outW, outH);
}

/** Zoom mantendo parado o ponto da foto que está sob (qx, qy) no quadro. */
export function zoomCropAt(crop, outW, outH, zoom, qx = outW / 2, qy = outH / 2) {
  const anchor = outputToImage(crop, outW, outH, qx, qy);
  const next = { ...crop, zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) };
  const s = cropScale(next, outW, outH);
  const t = next.rotation * DEG;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const dx = (qx - outW / 2) / s;
  const dy = (qy - outH / 2) / s;
  next.cx = anchor.x - (cos * dx + sin * dy);
  next.cy = anchor.y - (-sin * dx + cos * dy);
  return clampCrop(next, outW, outH);
}

/** Gira em torno do centro do quadro (o zoom relativo é mantido). */
export function rotateCrop(crop, outW, outH, degrees) {
  return clampCrop({ ...crop, rotation: degrees }, outW, outH);
}

/**
 * Fator de redução prévia para desenhar com qualidade. Reduzir uma foto grande direto
 * para 10% do tamanho num passo só pula pixels e deixa serrilhado; reduzir pela metade
 * várias vezes faz uma média decente. Devolve k (1, 1/2, 1/4...) tal que a escala que
 * sobra para o passo final, scale / k, fique em [0,5, 1) quando scale < 1.
 */
export function mipLevel(scale) {
  let level = 0;
  while (scale * 2 ** level < 0.5 && level < 12) level++;
  return level;
}

/**
 * Guias de enquadramento do rosto, em frações do quadro: topo da cabeça, linha dos
 * olhos, queixo e meia largura do oval. São aproximadas; cada órgão tem suas regras.
 */
export function faceGuides(photoId) {
  if (photoId === '5x7') return { top: 0.12, eyes: 0.43, chin: 0.74, halfWidth: 0.27 };
  return { top: 0.12, eyes: 0.42, chin: 0.72, halfWidth: 0.29 };
}
