# Noviforma Engineering Plan
Plan A: Tauri + Rust + wgpu (Windows-first, cross-platform-ready)

---

## 1. Engineering Goals

- Deliver a GPU-accelerated browsing experience for massive visual datasets (8K images and 8K video via proxy strategy).
- Keep the UI responsive under heavy IO, decoding, and AI workloads (no blocking UI thread).
- Separate concerns cleanly between UI (webview), core services, and renderer.
- Maintain portability across Windows, macOS, and Linux by isolating platform-specific code behind traits.

---

## 2. High-Level Architecture

### 2.1 Components

UI (Tauri Webview)
- React or Solid front-end
- Layout, panels, search/filter, node editor, inspector

Core (Rust)
- Indexing
- Database
- Cache manager
- Job system
- Node graph engine
- AI runtime

Renderer (Rust + wgpu)
- Noviforma Grid (GPU viewport)
- Viewer pipeline (image/video)

### 2.2 Threading Model

- UI thread: Webview event loop
- Core runtime: Tokio async tasks for IO and background jobs
- Renderer thread: Owns wgpu device, queue, surface, and render loop

---

## 3. Data Flow

### 3.1 UI to Core

- Open project / add roots
- Query assets (pagination, filters)
- Apply tags, notes, ratings
- Shot creation and asset assignment
- Graph save and run
- Viewport geometry and scroll state (used to compute visible tiles)

### 3.2 Core to UI

- Asset pages and metadata
- Indexing, proxy, and thumbnail progress
- Graph execution progress and results
- Notifications (errors, warnings)

### 3.3 Core to Renderer

- Visible tile descriptors (only what should be drawn)
- Texture availability updates (placeholder to thumbnail to proxy frame)
- Optional performance and debug toggles

---

## 4. Repository Layout (Proposed)

/apps
  /ui                      # Noviforma UI (React or Solid)

/src-tauri                 # Tauri integration (Rust)

/crates
  /noviforma-app           # IPC wiring and orchestration
  /noviforma-core          # Database, indexing, cache, job system
  /noviforma-renderer      # wgpu grid and viewer renderer
  /noviforma-media         # Decode and proxy pipeline (future)
  /noviforma-graph         # DAG execution and caching
  /noviforma-ai            # AI inference runtime (ONNX / DirectML)

/docs
  design.md
  engineering.md

---

## 5. Storage and Cache

### 5.1 Database

- SQLite (via sqlx or rusqlite)
- Stores:
  - assets
  - tags
  - notes
  - shots
  - shot_assets
  - graphs
  - graph_runs
  - derived file records

### 5.2 On-Disk Cache Layout (per project)

- ProjectRoot/_cache/thumbs/
- ProjectRoot/_cache/proxies/
- ProjectRoot/_outputs/<shot>/<task>/<version>/

### 5.3 Budgeting and Eviction

- Disk cache: size-limited with LRU eviction
- RAM cache: decoded frames and hot metadata (LRU)
- VRAM cache: uploaded textures with strict budgets and LRU eviction

---

## 6. Job System

### 6.1 Job Types

- Index roots
- Generate thumbnails
- Generate proxies
- Decode frames (viewer or preview)
- Execute node graphs
- AI inference

### 6.2 Priorities

- Viewer asset: highest priority (immediate user intent)
- Visible tiles: high priority (thumbnail or proxy readiness)
- User-run graph: high priority
- Background indexing: low priority
- Proxy generation: medium or low priority unless required for preview

### 6.3 Cancellation

- Graph runs and long proxy jobs must be cancellable
- Cancellation must promptly release GPU and decoder resources

---

## 7. Rendering Strategy (Critical)

### 7.1 Rule: No DOM Grid

The grid must not consist of thousands of image or video elements.  
The UI computes layout; the renderer draws pixels.

### 7.2 Noviforma Grid (M0 to M2)

- Instanced quad rendering (one quad, many instances)
- Per-frame instance buffer contains only visible tiles:
  - position in pixels
  - size in pixels
  - color (M0) transitioning to texture index and UVs (later)
- Placeholder textures shown until thumbnails are ready
- Future texture strategy:
  - texture arrays for thumbnails
  - optional atlas packing

### 7.3 Viewer Pipeline

Image viewer
- Mipmaps
- Smooth zoom and pan
- Pixel inspection

Video viewer
- Proxy-first decoding
- Ring buffer of GPU textures for frames

### 7.4 Performance Telemetry

Built-in performance HUD:
- Frames per second and frame time
- Instance count
- Texture upload time
- Cache hit rates (future)

---

## 8. Media Pipeline (Phased)

### 8.1 Version 1

- File indexing and thumbnails
- Image viewer for common formats
- Dummy or proxy placeholders for video

### 8.2 Version 2 and Beyond

- FFmpeg decode with hardware acceleration
- Proxy generation pipeline
- Hover-preview policy with limited concurrent decoders

### 8.3 Version 3 and Beyond

- EXR support
- OCIO integration for studio workflows

---

## 9. Node Graph Engine

### 9.1 Graph Model

- Directed acyclic graph with typed ports:
  - Image
  - Video
  - Mask
  - Text
  - Number
- Node definition includes:
  - Input and output schema
  - Parameter schema
  - Compute backend (CPU, GPU, AI)
  - Cache key function

### 9.2 Deterministic Caching

- Node cache key equals hash of inputs, parameters, and node version
- Graph run cache equals hash of graph, inputs, and environment

### 9.3 Execution

- Topological sort
- Concurrent execution where safe
- Capture timings per node and per graph run

---

## 10. AI Runtime

### 10.1 Version 1 Recommendation

- ONNX Runtime with DirectML for Windows GPU compatibility

### 10.2 Abstraction Strategy

Inference is wrapped behind a Rust trait to allow future backends:
- CUDA (NVIDIA)
- Metal (macOS)
- Vulkan compute (Linux)

---

## 11. IPC: Tauri Commands and Events

### 11.1 Commands (UI to Rust)

All commands are prefixed with noviforma_.

- noviforma_open_project(project_path)
- noviforma_scan_roots(roots)
- noviforma_query_assets(query)
- noviforma_set_asset_tags(asset_ids, tags)
- noviforma_set_asset_note(asset_id, note)
- noviforma_create_shot(parent_id, name)
- noviforma_assign_assets_to_shot(shot_id, asset_ids, role)
- noviforma_save_graph(graph)
- noviforma_run_graph(graph_id, inputs)
- noviforma_renderer_set_viewport(width, height, dpr)
- noviforma_renderer_set_visible_tiles(payload)

Visible tile updates must be batched and compact.  
Binary payloads should be used if JSON becomes a bottleneck.

### 11.2 Events (Rust to UI)

- noviforma_asset_index_progress
- noviforma_assets_updated
- noviforma_thumb_ready
- noviforma_proxy_ready
- noviforma_graph_progress
- noviforma_graph_complete
- noviforma_perf_stats

---

## 12. Milestones

### M0 — Dummy GPU Grid

- Render N tiles using instancing (colored quads)
- UI scroll drives visible tile list
- Performance HUD showing FPS and instance count

### M1 — Index, Database, Thumbnails

- Scan roots and store assets in SQLite
- Generate thumbnails via job system
- Upload thumbnails to GPU and display in grid

### M2 — Viewer (Image and Proxy Video)

- Image viewer with mipmaps and zoom
- Prototype proxy decode path for video

### M3 — Shots and Versions

- Shot tree
- Asset assignment and version detection
- Inspector integration

### M4 — Graph Engine

- Graph schema
- Run and cancel execution
- Cached outputs appear as versions in outputs folder

### M5 — AI Nodes

- ONNX and DirectML integration
- Essential AI nodes (text-to-image, image-to-image, upscale where feasible)

---

## 13. Engineering Risks and Mitigations

- VRAM exhaustion: strict budgets, mipmaps, and LRU eviction
- Video preview thrash: proxy-first strategy and decoder limits
- IPC overhead: batch updates and compact payloads
- Platform drift: isolate OS-specific code behind traits
