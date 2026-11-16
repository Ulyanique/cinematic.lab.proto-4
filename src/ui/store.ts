import { useEffect } from "react";
import { defaultConfig, normalizeConfig, type Config } from "../intro/schema";

export const STORAGE_KEY = "cinematic-lab.config.v2";

/** Шина времени: движок → DOM-оверлеи без перерисовок React */
type Fn = (t: number, playing: boolean) => void;
const listeners = new Set<Fn>();
export const timeBus = {
  t: 0,
  playing: false,
  emit(t: number, p: boolean) {
    this.t = t;
    this.playing = p;
    listeners.forEach((f) => f(t, p));
  },
  subscribe(f: Fn) {
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  },
};

export function useTime(fn: Fn, deps: unknown[] = []) {
  useEffect(() => {
    fn(timeBus.t, timeBus.playing);
    return timeBus.subscribe(fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeConfig(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return defaultConfig();
}

export function saveConfig(c: Config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

export const hash2 = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
