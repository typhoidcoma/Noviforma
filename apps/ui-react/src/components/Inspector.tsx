import { useEffect, useMemo, useState } from "react";
import type { Asset, Shot, Tag } from "../lib/database";
import {
  dbAddTagToAsset,
  dbGetAllTags,
  dbGetAssetNote,
  dbGetAssetRating,
  dbGetAssetTags,
  dbRemoveTagFromAsset,
  dbSetAssetNote,
  dbSetAssetRating,
} from "../lib/database";

interface InspectorProps {
  selectedAssets: Asset[];
}

export function Inspector({ selectedAssets }: InspectorProps) {
  const [assetTags, setAssetTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [note, setNote] = useState("");
  const [rating, setRating] = useState(0);

  const single = selectedAssets.length === 1 ? selectedAssets[0] : null;

  useEffect(() => {
    if (!single) {
      setAssetTags([]);
      setAllTags([]);
      setNote("");
      setRating(0);
      return;
    }
    Promise.all([
      dbGetAssetTags(single.id),
      dbGetAllTags(),
      dbGetAssetNote(single.id),
      dbGetAssetRating(single.id),
    ])
      .then(([tags, all, currentNote, currentRating]) => {
        setAssetTags(tags);
        setAllTags(all);
        setNote(currentNote?.content ?? "");
        setRating(currentRating?.rating ?? 0);
      })
      .catch(console.error);
  }, [single?.id]);

  const availableTags = useMemo(() => {
    const assigned = new Set(assetTags.map((t) => t.id));
    return allTags.filter((t) => !assigned.has(t.id));
  }, [allTags, assetTags]);

  if (selectedAssets.length === 0) {
    return <div className="inspector-empty">No assets selected</div>;
  }

  if (!single) {
    return <div className="inspector-empty">{selectedAssets.length} assets selected</div>;
  }

  return (
    <div className="inspector">
      <h3>{single.filename}</h3>
      <p className="muted">{single.path}</p>

      <div className="section">
        <div className="label">Rating</div>
        <div className="stars">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              onClick={async () => {
                const next = value === rating ? 0 : value;
                await dbSetAssetRating(single.id, next);
                setRating(next);
              }}
            >
              {value <= rating ? "★" : "☆"}
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="label">Tags</div>
        <div className="chips">
          {assetTags.map((tag) => (
            <button
              key={tag.id}
              className="chip"
              style={{ borderLeft: `4px solid ${tag.color ?? "#8a8e7a"}` }}
              onClick={async () => {
                await dbRemoveTagFromAsset(single.id, tag.id);
                const tags = await dbGetAssetTags(single.id);
                setAssetTags(tags);
              }}
            >
              {tag.name} ×
            </button>
          ))}
        </div>
        <div className="chips">
          {availableTags.map((tag) => (
            <button
              key={tag.id}
              className="chip chip-add"
              onClick={async () => {
                await dbAddTagToAsset(single.id, tag.id);
                const tags = await dbGetAssetTags(single.id);
                setAssetTags(tags);
              }}
            >
              + {tag.name}
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="label">Notes</div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => dbSetAssetNote(single.id, note).catch(console.error)}
          rows={6}
          placeholder="Add notes..."
        />
      </div>
    </div>
  );
}
