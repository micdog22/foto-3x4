// Unidades e tamanhos: milímetros, polegadas e pixels.
//
// Uma polegada tem exatamente 25,4 mm. A 300 dpi (pontos por polegada), cada milímetro
// vira 300 / 25,4 = 11,811... pixels. Por isso uma foto 3x4 cm tem 354 x 472 pixels e
// uma folha 10x15 cm tem 1181 x 1772 pixels.

export const MM_PER_INCH = 25.4;
export const DEFAULT_DPI = 300;

/** Milímetros para pixels, sem arredondar. */
export function mmToPxExact(mm, dpi = DEFAULT_DPI) {
  return (mm * dpi) / MM_PER_INCH;
}

/** Milímetros para pixels inteiros (arredondamento para o mais próximo). */
export function mmToPx(mm, dpi = DEFAULT_DPI) {
  return Math.round(mmToPxExact(mm, dpi));
}

/** Pixels para milímetros. */
export function pxToMm(px, dpi = DEFAULT_DPI) {
  return (px * MM_PER_INCH) / dpi;
}

// Tamanhos de foto (largura x altura, em mm).
export const PHOTOS = {
  '3x4': { id: '3x4', name: '3 x 4 cm', w: 30, h: 40 },
  '5x7': { id: '5x7', name: '5 x 7 cm', w: 50, h: 70 },
};

// Papéis (sempre em pé). `margin` é a margem mínima sugerida: impressoras não
// imprimem rente à borda e lojas de revelação às vezes cortam um pouquinho.
export const PAPERS = {
  '10x15': { id: '10x15', name: '10 x 15 cm', w: 100, h: 150, margin: 2 },
  a4: { id: 'a4', name: 'A4 (21 x 29,7 cm)', w: 210, h: 297, margin: 6 },
};

/** Tamanho em pixels de uma foto ou papel na resolução pedida. */
export function sizeInPx(item, dpi = DEFAULT_DPI) {
  return { w: mmToPx(item.w, dpi), h: mmToPx(item.h, dpi) };
}

/** Número formatado em pt-BR com até `digits` casas ("2,5", "10"). */
export function formatMm(value, digits = 1) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(value);
}
