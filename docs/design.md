# docs/design.md
# Shot/Asset Browser + Node AI Workflow (Plan A: Tauri + Rust + wgpu)

## 1. Summary
Build a Windows-first (cross-platform-ready) desktop application for browsing, organizing, and processing high-resolution media, optimized for **8K images and 8K video**. The app prioritizes **instant interaction**, **GPU-accelerated grid rendering**, and a **simple node-based workflow** for AI generation and processing.

Stack: **Tauri (UI shell)** + **Rust (core)** + **wgpu (GPU renderer)**.

## 2. Product Goals
### 2.1 Must-have (v1)
- GPU-driven **grid viewport** for browsing large media sets.
- Progressive loading: placeholder → thumbnail → proxy → full-res in viewer.
- Shot/sequence organization and versioning.
- Tagging, notes, ratings, and fast search/filter.
- Node graph for AI + processing (small, essential node set).
- Non-destructive workflow: edits are metadata + derived outputs.

### 2.2 Nice-to-have (v1.5+)
- A/B compare, wipe, onion-skin.
- OCIO color management pipeline.
- Collaborative projects / shared DB.
- Remote AI providers as plugins.

## 3. Non-Goals (v1)
- Full NLE timeline editing.
- Full compositing suite.
- Training AI models locally (inference only).
- Cloud sync / multi-user permissions.

## 4. Target Users
- VFX artists, technical artists, small studios.
- Anyone handling large shot libraries with frequent iteration and review.

## 5. Key User Stories
### Browsing / Review
- Open a folder/project and instantly see a grid of assets.
- Scroll smoothly through thousands of items.
- Hover a tile to preview proxy video quickly.
- Click to open viewer for zoom/pan (images) or scrubbing (video).

### Organization
- Create Sequence/Shot structure.
- Drag assets into shots, auto-detect versions (v001, v002…).
- Tag assets and shots (e.g., “client-note”, “needs-roto”).
- Add notes and ratings; search/filter instantly.

### Node Workflows
- Create a graph: Load → Resize → AI Generate → Save.
- Run graph; outputs appear as versions in a shot.
- Re-run graph with changed prompt/settings; previous outputs remain accessible.

## 6. UX Principles
- **Speed is the product.** No blocking UI thread.
- **Progressive detail.** Show something instantly, refine in the background.
- **Simple graph.** 10–20 essential nodes; minimize complexity.
- **Predictable outputs.** Clear naming, locations, and versioning.

## 7. Screens (v1)
### 7.1 Project Browser
- Left: Sequences/Shots, Collections, Tags
- Center: GPU Grid (tiles)
- Right: Inspector (metadata, notes, tags, versions)

### 7.2 Viewer
- Image: zoom/pan, pixel inspect, basic adjust preview
- Video: scrub, frame-step, proxy/original toggle (optional)
- Compare: A/B (optional v1.5)

### 7.3 Node Graph
- Canvas with nodes and connections
- Run / Cancel / Cache controls
- Log panel with timings per node

## 8. Performance Targets (v1)
- Grid interaction stays responsive at **60 fps minimum** (higher on capable GPUs).
- First visible grid content: **placeholders immediately**, thumbnails stream in.
- Hover preview start (proxy): target **< 150 ms** (best-effort).
- Viewer open: target **< 200 ms** with warm cache.
- Background indexing and proxy generation must never block UI.

## 9. Media Quality Strategy
- Default derived assets:
  - **Thumbnail** (512–1024 px)
  - **Proxy** video (e.g., 1080p/2K) for grid playback and viewer scrubbing
- Full-res decode:
  - Only in viewer or explicit user action

## 10. Project & Data Model (conceptual)
- Project:
  - Source roots (folders)
  - Assets (files + metadata)
  - Shots (hierarchy)
  - Relationships (shot_assets, versions)
  - Tags/notes/ratings
  - Graph definitions & runs (inputs, outputs, timings)

## 11. AI Scope (v1)
- Inference only:
  - Text-to-image, image-to-image, upscale, background remove (as feasible)
- Backends:
  - Local (ONNX Runtime + DirectML)
  - Optional plugins later

## 12. Milestones (high level)
- M0: GPU grid prototype (dummy tiles)
- M1: Indexer + thumbnails + DB
- M2: Viewer (image + proxy video)
- M3: Shot organization + tags + versions
- M4: Node graph engine + essential nodes
- M5: AI nodes + output management + export
- M6: Performance hardening + packaging

## 13. Risks
- DOM-based grids will not scale; must be GPU-rendered.
- Memory pressure: VRAM/RAM budgets and LRU caching are mandatory.
- Video decoding throughput and hover preview concurrency must be limited.
- AI model/runtime compatibility (drivers, DirectML performance variability).
