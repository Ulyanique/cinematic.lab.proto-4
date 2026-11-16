// ──────────────────────────────────────────────────────────────
//  Схема конфигурации композиции: типы, поля, значения по умолчанию,
//  пресеты анимации и нормализация (импорт/экспорт JSON)
// ──────────────────────────────────────────────────────────────

export type Settings = Record<string, any>;

export type FieldDef =
  | { t: "head"; label: string }
  | { t: "num"; k: string; label: string; min: number; max: number; step: number; unit?: string }
  | { t: "color"; k: string; label: string }
  | { t: "bool"; k: string; label: string }
  | { t: "sel"; k: string; label: string; opts: [string, string][] }
  | { t: "text"; k: string; label: string; multiline?: boolean };

export interface Layer {
  id: string;
  type: LayerTypeId;
  name: string;
  on: boolean;
  s: Settings;
}

export interface Config {
  app: "cinematic-lab";
  v: 2;
  g: Settings;
  layers: Layer[];
}

export type LayerTypeId = "world" | "crystals" | "particles" | "explosion" | "logo" | "text" | "bars" | "hud";

export interface LayerTypeDef {
  label: string;
  kind: "3d" | "2d";
  multi: boolean;
  fields: FieldDef[];
  defaults: Settings;
  presets?: { key: string; label: string; values: Settings }[];
  presetKey?: string;
}

const num = (k: string, label: string, min: number, max: number, step: number, unit?: string): FieldDef => ({
  t: "num",
  k,
  label,
  min,
  max,
  step,
  unit,
});
const color = (k: string, label: string): FieldDef => ({ t: "color", k, label });
const bool = (k: string, label: string): FieldDef => ({ t: "bool", k, label });
const sel = (k: string, label: string, opts: [string, string][]): FieldDef => ({ t: "sel", k, label, opts });
const head = (label: string): FieldDef => ({ t: "head", label });

// ───────────────────────────── глобальные ─────────────────────────────
export const GLOBAL_FIELDS: FieldDef[] = [
  head("Время"),
  num("speed", "Скорость", 0.1, 3, 0.05, "×"),
  num("startAt", "Старт с", 0, 60, 0.1, "с"),
  num("duration", "Длительность", 10, 90, 0.5, "с"),
  bool("loop", "Зациклить"),
  bool("autoplay", "Автозапуск"),
  num("fadeIn", "Появление из чёрного", 0, 6, 0.1, "с"),
  num("fadeOut", "Уход в чёрное", 0, 10, 0.1, "с"),
  head("Камера"),
  num("fovAdd", "FOV +/−", -30, 30, 0.5, "°"),
  num("shake", "Тряска", 0, 3, 0.05, "×"),
  num("roll", "Крен камеры", 0, 2.5, 0.05, "×"),
  num("heightAdd", "Высота", -3, 6, 0.1),
  head("Свет и пост-обработка"),
  num("exposure", "Экспозиция", 0.3, 2, 0.01),
  num("bloom", "Bloom сила", 0, 3, 0.05),
  num("bloomRadius", "Bloom радиус", 0, 1.5, 0.05),
  num("bloomThreshold", "Bloom порог", 0.3, 2.5, 0.05),
  num("streak", "Анаморфные стрики", 0, 3, 0.05),
  num("aberration", "Хроматическая аберрация", 0, 4, 0.05, "×"),
  num("vignette", "Виньетка", 0, 1.6, 0.05),
  num("grain", "Плёночное зерно", 0, 4, 0.05, "×"),
  head("Цветокоррекция"),
  num("hue", "Оттенок (hue)", -180, 180, 1, "°"),
  num("saturation", "Насыщенность", 0, 2, 0.01),
  num("contrast", "Контраст", 0.5, 1.6, 0.01),
  color("tint", "Тонировка"),
  num("tintAmount", "Сила тонировки", 0, 1, 0.01),
  head("Качество"),
  num("pixelRatio", "Макс. pixel ratio", 0.5, 2.5, 0.05),
];

export const DEFAULT_GLOBAL: Settings = {
  speed: 1,
  startAt: 0,
  duration: 40,
  loop: false,
  autoplay: true,
  fadeIn: 2.6,
  fadeOut: 0,
  fovAdd: 0,
  shake: 1,
  roll: 1,
  heightAdd: 0,
  exposure: 1,
  bloom: 1,
  bloomRadius: 0.6,
  bloomThreshold: 1,
  streak: 1,
  aberration: 1,
  vignette: 1,
  grain: 1,
  hue: 0,
  saturation: 1,
  contrast: 1,
  tint: "#ffb050",
  tintAmount: 0,
  pixelRatio: 1.75,
};

// ───────────────────────────── типы слоёв ─────────────────────────────
const EASES: [string, string][] = [
  ["cubic", "Cubic (плавно)"],
  ["expo", "Expo (резко → плавно)"],
  ["back", "Back (перелёт)"],
  ["bounce", "Bounce (отскок)"],
  ["elastic", "Elastic (пружина)"],
  ["linear", "Linear"],
];

const LOGO_PRESETS: { key: string; label: string; values: Settings }[] = [
  {
    key: "classic",
    label: "Золотое проявление",
    values: { reveal: "wipeUp", assemble: "none", amount: 8, stagger: 0.3, ease: "cubic", duration: 3.4, spinIn: 52, scaleFrom: 1.1, flash: 1.2, idle: "sway", glint: 0.9 },
  },
  {
    key: "shatter",
    label: "Сборка из осколков",
    values: { reveal: "noise", assemble: "scatter", amount: 9, stagger: 0.55, ease: "expo", duration: 3.8, spinIn: 0, scaleFrom: 1, flash: 1.4, idle: "sway", glint: 1 },
  },
  {
    key: "spiral",
    label: "Золотая спираль",
    values: { reveal: "radial", assemble: "spiral", amount: 12, stagger: 0.4, ease: "cubic", duration: 4, spinIn: 120, scaleFrom: 1, flash: 1.2, idle: "float", glint: 1 },
  },
  {
    key: "unfold",
    label: "Раскрытие циркуля",
    values: { reveal: "radial", assemble: "unfold", amount: 6, stagger: 0.25, ease: "back", duration: 3.2, spinIn: 20, scaleFrom: 1, flash: 1, idle: "sway", glint: 1.2 },
  },
  {
    key: "scan",
    label: "Лазерное сканирование",
    values: { reveal: "scan", assemble: "none", amount: 8, stagger: 0, ease: "linear", duration: 2.8, spinIn: 0, scaleFrom: 1, flash: 2, idle: "sway", glint: 1.5, edgeColor: "#fff6d8" },
  },
  {
    key: "radial",
    label: "Радиальный всплеск",
    values: { reveal: "radial", assemble: "none", amount: 8, stagger: 0, ease: "expo", duration: 2.6, spinIn: 0, scaleFrom: 1.6, flash: 2.2, idle: "pulse", glint: 1 },
  },
  {
    key: "drop",
    label: "Падение с отскоком",
    values: { reveal: "none", assemble: "drop", amount: 14, stagger: 0.35, ease: "bounce", duration: 3, spinIn: 0, scaleFrom: 1, flash: 0.8, idle: "float", glint: 1 },
  },
  {
    key: "implode",
    label: "Схлопывание из космоса",
    values: { reveal: "noise", assemble: "implode", amount: 34, stagger: 0.45, ease: "expo", duration: 3.2, spinIn: 180, scaleFrom: 1, flash: 1.8, idle: "sway", glint: 1 },
  },
  {
    key: "rise",
    label: "Всплытие из земли",
    values: { reveal: "wipeUp", assemble: "rise", amount: 9, stagger: 0.35, ease: "cubic", duration: 3.6, spinIn: 0, scaleFrom: 1, flash: 1, idle: "float", glint: 1 },
  },
  {
    key: "turntable",
    label: "Разворот 360°",
    values: { reveal: "wipeDown", assemble: "none", amount: 8, stagger: 0, ease: "expo", duration: 3.6, spinIn: 360, scaleFrom: 1, flash: 1.2, idle: "spin", glint: 1 },
  },
  {
    key: "glitch",
    label: "Цифровой глитч",
    values: { reveal: "noise", assemble: "glitch", amount: 3, stagger: 0.5, ease: "linear", duration: 2.4, spinIn: 0, scaleFrom: 1, flash: 1.6, idle: "sway", glint: 0.8, edgeColor: "#ffe9b0" },
  },
  {
    key: "zoom",
    label: "Удар масштабом",
    values: { reveal: "none", assemble: "none", amount: 8, stagger: 0, ease: "expo", duration: 1.6, spinIn: 0, scaleFrom: 3.6, flash: 2.4, idle: "pulse", glint: 1.4 },
  },
  {
    key: "levitate",
    label: "Левитация",
    values: { reveal: "wipeUp", assemble: "none", amount: 8, stagger: 0, ease: "cubic", duration: 5, spinIn: 25, scaleFrom: 1, flash: 0.6, idle: "float", idleAmp: 1.2, glint: 0.7 },
  },
  {
    key: "minimal",
    label: "Тихое проявление",
    values: { reveal: "noise", assemble: "none", amount: 8, stagger: 0, ease: "cubic", duration: 4.4, spinIn: 0, scaleFrom: 1, flash: 0.3, idle: "none", glint: 0.5 },
  },
];

const TEXT_PRESETS: { key: string; label: string; values: Settings }[] = [
  { key: "trackIn", label: "Стягивание трекинга", values: { anim: "trackIn", stagger: 0, blur: 6 } },
  { key: "lettersRise", label: "Буквы всплывают", values: { anim: "lettersRise", stagger: 0.8, blur: 8 } },
  { key: "blurIn", label: "Проявление из размытия", values: { anim: "blurIn", stagger: 0, blur: 16 } },
  { key: "maskUp", label: "Выезд из-под маски", values: { anim: "maskUp", stagger: 0.6, blur: 0 } },
  { key: "typewriter", label: "Печатная машинка", values: { anim: "typewriter", stagger: 1, blur: 0 } },
  { key: "scaleIn", label: "Удар масштабом", values: { anim: "scaleIn", stagger: 0.4, blur: 4 } },
  { key: "glitch", label: "Глитч", values: { anim: "glitch", stagger: 0.5, blur: 0 } },
  { key: "fade", label: "Плавное появление", values: { anim: "fade", stagger: 0, blur: 0 } },
];

const FONTS: [string, string][] = [
  ['"Helvetica Neue", Helvetica, Arial, sans-serif', "Helvetica"],
  ['"Trebuchet MS", "Lucida Grande", sans-serif', "Trebuchet"],
  ['"Optima", "Candara", "Segoe UI", sans-serif', "Optima / Humanist"],
  ['Georgia, "Times New Roman", serif', "Georgia (serif)"],
  ['"Palatino Linotype", Palatino, "Book Antiqua", serif', "Palatino"],
  ['Impact, "Arial Narrow Bold", sans-serif', "Impact"],
  ['"Courier New", Courier, monospace', "Courier (mono)"],
  ["system-ui, sans-serif", "System UI"],
];

const OVERLAY = bool("overlay", "Поверх остальных 3D (игнор. глубину)");

export const LAYER_TYPES: Record<LayerTypeId, LayerTypeDef> = {
  world: {
    label: "Мир (небо, рельеф, башни)",
    kind: "3d",
    multi: false,
    fields: [
      head("Атмосфера"),
      num("fogDensity", "Плотность тумана", 0, 0.02, 0.0002),
      color("fogColor", "Цвет тумана"),
      num("skyBright", "Яркость неба", 0, 3, 0.05, "×"),
      head("Материал"),
      num("env", "Отражения (env)", 0, 2.5, 0.05, "×"),
      num("edge", "Свечение рёбер", 0, 3, 0.05, "×"),
      num("shock", "Волна взрыва по рельефу", 0, 3, 0.05, "×"),
      OVERLAY,
    ],
    defaults: { fogDensity: 0.0049, fogColor: "#7c511b", skyBright: 1, env: 1, edge: 1, shock: 1, overlay: false },
  },
  crystals: {
    label: "Кристаллы-экраны",
    kind: "3d",
    multi: false,
    fields: [
      head("Появление"),
      num("riseShift", "Сдвиг старта", -6, 10, 0.1, "с"),
      num("riseGap", "Интервал между кристаллами", 0.1, 1.6, 0.02, "с"),
      num("riseDur", "Длительность роста", 1, 6, 0.1, "с"),
      num("scale", "Масштаб", 0.4, 1.6, 0.01, "×"),
      head("Свечение"),
      num("beam", "Световые столбы", 0, 3, 0.05, "×"),
      num("glow", "Свечение у основания", 0, 3, 0.05, "×"),
      num("baseGlow", "Свечение граней", 0, 3, 0.05, "×"),
      head("Экраны"),
      bool("screens", "Показывать экраны"),
      num("screenBright", "Яркость экранов", 0, 2.5, 0.05, "×"),
      { t: "text", k: "videos", label: "Видео URL (mp4/webm), по одному на строку — до 10", multiline: true },
      OVERLAY,
    ],
    defaults: { riseShift: 0, riseGap: 0.62, riseDur: 2.8, scale: 1, beam: 1, glow: 1, baseGlow: 1, screens: true, screenBright: 1, videos: "", overlay: false },
  },
  particles: {
    label: "Частицы (искры, заряд)",
    kind: "3d",
    multi: false,
    fields: [
      num("embers", "Искры в воздухе", 0, 4, 0.05, "×"),
      num("emberSize", "Размер искр", 10, 200, 1),
      num("charge", "Частицы заряда (к ядру)", 0, 4, 0.05, "×"),
      OVERLAY,
    ],
    defaults: { embers: 1, emberSize: 70, charge: 1, overlay: false },
  },
  explosion: {
    label: "Взрыв и ядро",
    kind: "3d",
    multi: false,
    fields: [
      head("Вспышка"),
      num("flash", "Сила вспышки", 0, 2, 0.02, "×"),
      color("flashColor", "Цвет вспышки"),
      num("zoomBlur", "Радиальное смазывание", 0, 3, 0.05, "×"),
      num("camShake", "Тряска камеры от взрыва", 0, 3, 0.05, "×"),
      head("Объекты"),
      num("core", "Размер ядра", 0.2, 2.5, 0.05, "×"),
      num("light", "Свет от ядра", 0, 3, 0.05, "×"),
      num("wave", "Ударные волны", 0, 3, 0.05, "×"),
      num("sparks", "Искры взрыва", 0, 3, 0.05, "×"),
      bool("debris", "Осколки"),
      num("debrisSize", "Размер осколков", 0.2, 3, 0.05, "×"),
      OVERLAY,
    ],
    defaults: { flash: 1, flashColor: "#fff3d3", zoomBlur: 1, camShake: 1, core: 1, light: 1, wave: 1, sparks: 1, debris: true, debrisSize: 1, overlay: false },
  },
  logo: {
    label: "Логотип 3D",
    kind: "3d",
    multi: true,
    presetKey: "preset",
    presets: LOGO_PRESETS,
    fields: [
      head("Анимация появления"),
      { t: "sel", k: "preset", label: "Пресет", opts: LOGO_PRESETS.map((p) => [p.key, p.label] as [string, string]) },
      num("delay", "Задержка от взрыва", -2, 12, 0.05, "с"),
      num("duration", "Длительность", 0.3, 10, 0.05, "с"),
      sel("reveal", "Растворение", [
        ["none", "Нет"],
        ["wipeUp", "Сверху вниз"],
        ["wipeDown", "Снизу вверх"],
        ["wipeX", "Слева направо"],
        ["radial", "Из центра"],
        ["noise", "Шумом"],
        ["scan", "Диагональный скан"],
      ]),
      sel("assemble", "Сборка деталей", [
        ["none", "Нет"],
        ["scatter", "Осколки"],
        ["spiral", "Спираль"],
        ["implode", "Схлопывание"],
        ["drop", "Падение"],
        ["unfold", "Раскрытие ног"],
        ["rise", "Всплытие"],
        ["glitch", "Глитч"],
      ]),
      num("amount", "Дальность разлёта", 0, 40, 0.5),
      num("stagger", "Смещение по деталям", 0, 0.9, 0.01),
      sel("ease", "Кривая", EASES),
      num("spinIn", "Доп. вращение при входе", 0, 720, 5, "°"),
      num("scaleFrom", "Начальный масштаб", 0.2, 6, 0.05, "×"),
      num("flash", "Яркость кромки растворения", 0, 4, 0.05, "×"),
      color("edgeColor", "Цвет кромки"),
      head("Постоянное движение"),
      sel("idle", "Idle", [
        ["none", "Нет"],
        ["sway", "Покачивание"],
        ["float", "Парение"],
        ["spin", "Вращение"],
        ["pulse", "Пульсация"],
      ]),
      num("idleAmp", "Амплитуда", 0, 3, 0.05, "×"),
      num("idleSpeed", "Скорость", 0, 4, 0.05, "×"),
      head("Трансформация"),
      num("x", "Позиция X", -12, 12, 0.05),
      num("y", "Позиция Y", -2, 16, 0.05),
      num("z", "Позиция Z", -10, 10, 0.05),
      num("scale", "Масштаб", 0.1, 5, 0.01),
      num("depth", "Толщина (по Z)", 0.2, 4, 0.05, "×"),
      num("rotX", "Поворот X", -180, 180, 1, "°"),
      num("rotY", "Поворот Y", -180, 180, 1, "°"),
      num("rotZ", "Поворот Z", -180, 180, 1, "°"),
      head("Материал"),
      color("color", "Цвет металла"),
      num("metalness", "Металличность", 0, 1, 0.01),
      num("roughness", "Шероховатость", 0, 1, 0.01),
      num("envI", "Отражения", 0, 6, 0.05),
      color("emissive", "Свечение (цвет)"),
      num("emissiveI", "Свечение (сила)", 0, 4, 0.05),
      bool("flat", "Гранёное затенение"),
      num("glint", "Блик-проход", 0, 3, 0.05, "×"),
      num("glintEvery", "Период блика (0 = один раз)", 0, 20, 0.5, "с"),
      head("Дуга-циркуль"),
      bool("arc", "Показывать дугу"),
      color("arcColor", "Цвет дуги"),
      num("arcDelay", "Задержка дуги", 0, 5, 0.05, "с"),
      num("arcDur", "Длительность дуги", 0.3, 6, 0.05, "с"),
      head("Лучи и свечение"),
      num("rays", "Лучи света", 0, 3, 0.05, "×"),
      color("raysColor", "Цвет лучей"),
      num("raysSize", "Размер лучей", 0.3, 3, 0.05, "×"),
      num("glow", "Гало", 0, 3, 0.05, "×"),
      color("glowColor", "Цвет гало"),
      num("glowSize", "Размер гало", 0.3, 3, 0.05, "×"),
      head("Исчезновение"),
      num("outAt", "Исчезнуть через (0 = никогда)", 0, 30, 0.1, "с"),
      num("outDur", "Длительность исчезновения", 0.2, 6, 0.1, "с"),
      OVERLAY,
    ],
    defaults: {
      preset: "classic",
      delay: 0,
      duration: 3.4,
      reveal: "wipeUp",
      assemble: "none",
      amount: 8,
      stagger: 0.3,
      ease: "cubic",
      spinIn: 52,
      scaleFrom: 1.1,
      flash: 1.2,
      edgeColor: "#ffdd90",
      idle: "sway",
      idleAmp: 1,
      idleSpeed: 1,
      x: 0,
      y: 6.8,
      z: 0,
      scale: 1.5,
      depth: 1,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      color: "#ffcf63",
      metalness: 1,
      roughness: 0.16,
      envI: 2.2,
      emissive: "#5a2a00",
      emissiveI: 0.6,
      flat: true,
      glint: 0.9,
      glintEvery: 6,
      arc: true,
      arcColor: "#ffdd90",
      arcDelay: 1.5,
      arcDur: 2.6,
      rays: 1,
      raysColor: "#ffd481",
      raysSize: 1,
      glow: 1,
      glowColor: "#ffcb7c",
      glowSize: 1,
      outAt: 0,
      outDur: 1.6,
      overlay: false,
    },
  },
  text: {
    label: "Текст",
    kind: "2d",
    multi: true,
    presetKey: "anim",
    presets: TEXT_PRESETS,
    fields: [
      head("Содержимое"),
      { t: "text", k: "text", label: "Текст" },
      { t: "sel", k: "font", label: "Шрифт", opts: FONTS },
      num("weight", "Насыщенность шрифта", 100, 900, 100),
      num("size", "Размер", 0.6, 16, 0.1, "vw"),
      bool("upper", "ЗАГЛАВНЫЕ"),
      head("Анимация"),
      { t: "sel", k: "anim", label: "Пресет", opts: TEXT_PRESETS.map((p) => [p.key, p.label] as [string, string]) },
      sel("anchor", "Отсчёт от", [
        ["start", "Начала ролика"],
        ["boom", "Взрыва"],
        ["logo", "Появления логотипа"],
      ]),
      num("delay", "Задержка", -5, 40, 0.05, "с"),
      num("duration", "Длительность", 0.2, 10, 0.05, "с"),
      num("stagger", "Смещение по буквам", 0, 1.5, 0.02),
      num("blur", "Размытие", 0, 40, 1, "px"),
      num("spacingFrom", "Трекинг: начало", -0.2, 2, 0.01, "em"),
      num("spacing", "Трекинг: конец", -0.2, 2, 0.01, "em"),
      num("outAt", "Исчезнуть через (0 = никогда)", 0, 40, 0.1, "с"),
      num("outDur", "Длительность исчезновения", 0.2, 6, 0.1, "с"),
      head("Внешний вид"),
      color("color1", "Цвет (верх)"),
      color("color2", "Цвет (низ)"),
      num("opacity", "Прозрачность", 0, 1, 0.01),
      num("glow", "Свечение", 0, 60, 1, "px"),
      color("glowColor", "Цвет свечения"),
      num("shimmer", "Бегущий блик", 0, 3, 0.05, "×"),
      num("shimmerSpeed", "Скорость блика", 0.05, 2, 0.05),
      head("Положение"),
      num("x", "X", 0, 100, 0.5, "%"),
      num("y", "Y", 0, 100, 0.5, "%"),
    ],
    defaults: {
      text: "COMPASS",
      font: FONTS[0][0],
      weight: 200,
      size: 4.2,
      upper: true,
      anim: "trackIn",
      anchor: "logo",
      delay: 3,
      duration: 2.2,
      stagger: 0,
      blur: 6,
      spacingFrom: 0.9,
      spacing: 0.55,
      outAt: 0,
      outDur: 1.2,
      color1: "#fff6e0",
      color2: "#f0b341",
      opacity: 1,
      glow: 18,
      glowColor: "#ffaa32",
      shimmer: 1,
      shimmerSpeed: 0.22,
      x: 50,
      y: 88,
    },
  },
  bars: {
    label: "Кинополосы",
    kind: "2d",
    multi: false,
    fields: [
      num("height", "Высота", 0, 22, 0.1, "vh"),
      color("color", "Цвет"),
      num("inDur", "Выезд", 0.1, 5, 0.1, "с"),
      num("outAfter", "Уход после взрыва", -2, 12, 0.1, "с"),
      num("outDur", "Длительность ухода", 0.1, 8, 0.1, "с"),
      bool("keep", "Не убирать"),
    ],
    defaults: { height: 6.2, color: "#000000", inDur: 1.2, outAfter: 0.2, outDur: 3, keep: false },
  },
  hud: {
    label: "HUD (таймкод, прогресс, повтор)",
    kind: "2d",
    multi: false,
    fields: [
      bool("time", "Таймкод"),
      bool("progress", "Полоса прогресса"),
      bool("replay", "Кнопка «Повторить»"),
      bool("hideAfterLogo", "Скрывать к логотипу"),
      color("color", "Цвет"),
    ],
    defaults: { time: true, progress: true, replay: true, hideAfterLogo: true, color: "#fcd34d" },
  },
};

export const LAYER_TYPE_IDS = Object.keys(LAYER_TYPES) as LayerTypeId[];

// ───────────────────────────── по умолчанию ─────────────────────────────
let idc = 0;
export const newId = (type: string) => `${type}_${Date.now().toString(36)}${(idc++).toString(36)}`;

export function makeLayer(type: LayerTypeId, name?: string, over: Settings = {}, id?: string): Layer {
  const def = LAYER_TYPES[type];
  return {
    id: id ?? newId(type),
    type,
    name: name ?? def.label.split(" (")[0],
    on: true,
    s: { ...JSON.parse(JSON.stringify(def.defaults)), ...over },
  };
}

/** Список сверху вниз: верх = передний план */
export function defaultConfig(): Config {
  return {
    app: "cinematic-lab",
    v: 2,
    g: { ...DEFAULT_GLOBAL },
    layers: [
      makeLayer("hud", "HUD", {}, "hud"),
      makeLayer("bars", "Кинополосы", {}, "bars"),
      makeLayer(
        "text",
        "Слоган",
        { text: "PRECISION  ·  CRAFT  ·  VISION", anim: "blurIn", delay: 4.2, duration: 2, size: 0.95, weight: 300, spacingFrom: 0.5, spacing: 0.5, blur: 10, color1: "#ffe9b8", color2: "#ffd58a", opacity: 0.85, glow: 6, shimmer: 0, y: 93.5 },
        "tagline"
      ),
      makeLayer("text", "Название", {}, "brand"),
      makeLayer(
        "text",
        "Вступление",
        { text: "A  COMPASS  FILM", anim: "blurIn", anchor: "start", delay: 0.9, duration: 1.8, size: 1.05, weight: 300, spacingFrom: 0.9, spacing: 0.7, blur: 10, outAt: 2.4, outDur: 1.4, opacity: 0.8, glow: 8, shimmer: 1.2, y: 47 },
        "opener"
      ),
      makeLayer("logo", "Логотип", {}, "logo"),
      makeLayer("explosion", "Взрыв и ядро", {}, "explosion"),
      makeLayer("particles", "Частицы", {}, "particles"),
      makeLayer("crystals", "Кристаллы-экраны", {}, "crystals"),
      makeLayer("world", "Мир", {}, "world"),
    ],
  };
}

// ───────────────────────────── нормализация ─────────────────────────────
function mergeTyped(base: Settings, inp: any): Settings {
  const out: Settings = { ...base };
  if (!inp || typeof inp !== "object") return out;
  for (const k of Object.keys(base)) {
    const v = inp[k];
    if (v === undefined || v === null) continue;
    if (typeof base[k] === "number" && typeof v === "number" && isFinite(v)) out[k] = v;
    else if (typeof base[k] === "boolean" && typeof v === "boolean") out[k] = v;
    else if (typeof base[k] === "string" && typeof v === "string") out[k] = v;
  }
  return out;
}

/** Безопасно собирает конфиг из произвольного JSON (неизвестное отбрасывается, пропущенное — по умолчанию) */
export function normalizeConfig(inp: any): Config {
  const base = defaultConfig();
  if (!inp || typeof inp !== "object") return base;
  const g = mergeTyped(DEFAULT_GLOBAL, inp.g);
  let layers = base.layers;
  if (Array.isArray(inp.layers)) {
    const seen = new Set<string>();
    const singles = new Set<string>();
    layers = [];
    for (const raw of inp.layers) {
      if (!raw || typeof raw !== "object") continue;
      const type = raw.type as LayerTypeId;
      const def = LAYER_TYPES[type];
      if (!def) continue;
      if (!def.multi) {
        if (singles.has(type)) continue;
        singles.add(type);
      }
      let id = typeof raw.id === "string" && raw.id ? raw.id : newId(type);
      while (seen.has(id)) id = newId(type);
      seen.add(id);
      layers.push({
        id,
        type,
        name: typeof raw.name === "string" ? raw.name : def.label,
        on: raw.on !== false,
        s: mergeTyped(def.defaults, raw.s),
      });
    }
  }
  return { app: "cinematic-lab", v: 2, g, layers };
}
