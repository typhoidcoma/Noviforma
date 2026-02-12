/**
 * App settings with localStorage persistence
 */

export interface AppSettings {
  columns: number;        // 0 = auto, 1-20 = fixed column count
  gutter: number;         // px between tiles (0-64)
  leftPanelWidth: number;
  rightPanelWidth: number;
  maxTextureCacheMB: number;      // VRAM limit for texture cache (MB)
  useMaxTextureArraySize: boolean; // auto-detect max GPU layers
}

export const DEFAULT_SETTINGS: AppSettings = {
  columns: 0,
  gutter: 32,
  leftPanelWidth: 240,
  rightPanelWidth: 280,
  maxTextureCacheMB: 512,          // Default to 512MB
  useMaxTextureArraySize: true,    // Default to auto-detect max
};

const STORAGE_KEY = 'noviforma-settings';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
