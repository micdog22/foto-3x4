// Grava a resolução (dpi) no cabeçalho JFIF de um JPEG.
//
// O JPEG gerado pelo canvas não diz em que tamanho deve ser impresso. Quem lê a densidade
// (programas de impressão, quiosques de foto) usa o segmento APP0 "JFIF", logo depois do
// início do arquivo:
//
//   FF E0  tamanho(2)  "JFIF\0"  versão(2)  unidade(1)  Xdensidade(2)  Ydensidade(2)  miniatura...
//   0  1   2  3        4..8      9  10      11          12 13          14 15
//
// unidade 0 = só proporção, 1 = pontos por polegada, 2 = pontos por centímetro.
// Com unidade 1 e densidade 300, 1181 x 1772 pixels viram exatamente 10 x 15 cm.

const SOI = 0xd8;
const SOS = 0xda;
const EOI = 0xd9;

function isJfifApp0(bytes, p) {
  return bytes[p + 1] === 0xe0 && bytes[p + 4] === 0x4a && bytes[p + 5] === 0x46
    && bytes[p + 6] === 0x49 && bytes[p + 7] === 0x46 && bytes[p + 8] === 0x00;
}

function isExifApp1(bytes, p) {
  return bytes[p + 1] === 0xe1 && bytes[p + 4] === 0x45 && bytes[p + 5] === 0x78
    && bytes[p + 6] === 0x69 && bytes[p + 7] === 0x66 && bytes[p + 8] === 0x00;
}

/**
 * Lista os segmentos do cabeçalho (do SOI até o SOS, sem incluir os dados comprimidos).
 * Cada item: { marker, offset, end }. Lança erro se o arquivo não for um JPEG válido.
 */
export function headerSegments(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) {
    throw new Error('Não é um arquivo JPEG (falta o marcador SOI).');
  }
  const segments = [];
  let p = 2;
  while (p < bytes.length) {
    if (bytes[p] !== 0xff) throw new Error(`JPEG inválido: marcador esperado na posição ${p}.`);
    let q = p + 1;
    while (q < bytes.length && bytes[q] === 0xff) q++;
    if (q >= bytes.length) throw new Error('JPEG truncado.');
    const marker = bytes[q];
    if (marker === EOI) throw new Error('JPEG sem imagem (EOI antes do SOS).');
    if (q + 2 >= bytes.length) throw new Error('JPEG truncado.');
    const length = (bytes[q + 1] << 8) | bytes[q + 2];
    if (length < 2) throw new Error('JPEG inválido: tamanho de segmento menor que 2.');
    const end = q + 1 + length;
    if (end > bytes.length) throw new Error('JPEG truncado no meio de um segmento.');
    segments.push({ marker, offset: q - 1, end });
    if (marker === SOS) return segments;
    p = end;
  }
  throw new Error('JPEG sem segmento SOS.');
}

/** Densidade gravada no JFIF: { units, x, y }, ou null se não houver JFIF. */
export function readJfifDensity(bytes) {
  for (const seg of headerSegments(bytes)) {
    if (seg.end - seg.offset >= 16 && isJfifApp0(bytes, seg.offset)) {
      const p = seg.offset;
      return { units: bytes[p + 11], x: (bytes[p + 12] << 8) | bytes[p + 13], y: (bytes[p + 14] << 8) | bytes[p + 15] };
    }
  }
  return null;
}

/**
 * Devolve uma cópia do JPEG com a densidade em `dpi` pontos por polegada.
 *  - Se já existe APP0 JFIF, só os bytes de unidade e densidade mudam (a miniatura,
 *    se houver, é preservada).
 *  - Se não existe, um APP0 JFIF 1.01 de 16 bytes é inserido logo após o SOI.
 *  - Segmentos Exif (APP1) são removidos: eles podem trazer outra resolução (72 dpi é
 *    comum) e alguns programas dão preferência a ela. Os dados da imagem não mudam.
 * Retorna { bytes, inserted, removedExif }.
 */
export function setJpegDpi(bytes, dpi) {
  if (!Number.isInteger(dpi) || dpi < 1 || dpi > 65535) throw new RangeError('dpi precisa ser um inteiro entre 1 e 65535');
  const segments = headerSegments(bytes);
  const exif = segments.filter((s) => isExifApp1(bytes, s.offset));
  const jfif = segments.find((s) => s.end - s.offset >= 16 && isJfifApp0(bytes, s.offset));
  const removed = exif.reduce((n, s) => n + (s.end - s.offset), 0);
  const insertSize = jfif ? 0 : 18;
  const out = new Uint8Array(bytes.length - removed + insertSize);

  let w = 0;
  out[w++] = 0xff;
  out[w++] = SOI;
  if (!jfif) {
    out.set([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0x00, 0x00], w);
    w += 18;
  }
  let r = 2;
  let jfifAt = -1;
  for (const seg of segments) {
    if (exif.includes(seg)) {
      out.set(bytes.subarray(r, seg.offset), w); // bytes de preenchimento entre segmentos, se houver
      w += seg.offset - r;
      r = seg.end;
      continue;
    }
    if (seg === jfif) jfifAt = w + (seg.offset - r);
  }
  out.set(bytes.subarray(r), w);
  if (jfifAt >= 0) {
    out[jfifAt + 11] = 1;
    out[jfifAt + 12] = dpi >> 8;
    out[jfifAt + 13] = dpi & 255;
    out[jfifAt + 14] = dpi >> 8;
    out[jfifAt + 15] = dpi & 255;
  }
  return { bytes: out, inserted: !jfif, removedExif: exif.length };
}
