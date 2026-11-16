// ──────────────────────────────────────────────────────────────
//  Настройки интро
// ──────────────────────────────────────────────────────────────

/** Название бренда под логотипом */
export const BRAND = "COMPASS";
export const TAGLINE = "PRECISION  ·  CRAFT  ·  VISION";

/**
 * Источники видео для 10 кристаллов-плейсхолдеров.
 * Вставьте URL (mp4/webm) — и вместо заглушки на грани кристалла
 * будет играть ваше видео. null = красивая заглушка.
 */
export const VIDEO_SOURCES: (string | null)[] = [
  null, null, null, null, null, null, null, null, null, null,
];

/** Момент взрыва (сек) и общая длительность основной части */
export const T_BOOM = 30.4;
export const T_LOGO = T_BOOM + 0.9;
export const T_TOTAL = 38;

export const CRYSTAL_COUNT = 10;
