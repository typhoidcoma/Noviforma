import { convertFileSrc } from "@tauri-apps/api/core";

export function getAssetUrl(filePath: string): string {
  return convertFileSrc(filePath);
}
