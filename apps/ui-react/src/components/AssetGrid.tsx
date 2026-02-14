import type { Asset } from "../lib/database";
import { getAssetUrl } from "../lib/asset-urls";

interface AssetGridProps {
  assets: Asset[];
  selectedAssetIds: number[];
  onToggleSelect: (assetId: number, multi: boolean) => void;
}

export function AssetGrid({ assets, selectedAssetIds, onToggleSelect }: AssetGridProps) {
  return (
    <div className="asset-grid">
      {assets.map((asset) => {
        const selected = selectedAssetIds.includes(asset.id);
        return (
          <button
            key={asset.id}
            className={`asset-tile ${selected ? "selected" : ""}`}
            onClick={(e) => onToggleSelect(asset.id, e.ctrlKey || e.metaKey)}
          >
            <div className="asset-preview">
              <img src={getAssetUrl(asset.path)} alt={asset.filename} loading="lazy" />
            </div>
            <div className="asset-meta">
              <span title={asset.filename}>{asset.filename}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
