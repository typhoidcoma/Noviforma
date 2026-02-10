# noviforma-m0-checklist.md
Noviforma M0 Checklist — Dummy GPU Grid Prototype (Tauri + Rust + wgpu)

Goal: prove the core rendering approach (GPU grid, instancing, scroll-driven visibility) before media decoding, DB, thumbnails, or AI.

Definition of Done (M0):
- A Tauri desktop window launches reliably on Windows.
- The center viewport renders a GPU grid of tiles via wgpu instancing (no DOM grid).
- The UI can scroll/resize; only visible tiles are sent to Rust; renderer updates smoothly.
- Basic perf HUD shows FPS + visible tile count + instance upload time.
- No UI thread stalls under high tile counts (target: 10k tiles total, ~300–1500 visible depending on viewport).

---

## 0. Repo Setup

- [ ] Create repo folders:
  - [ ] `/apps/ui`
  - [ ] `/src-tauri`
  - [ ] `/crates/noviforma-renderer`
  - [ ] `/docs`
- [ ] Add docs:
  - [ ] `docs/design.md`
  - [ ] `docs/engineering.md`
  - [ ] `docs/noviforma-m0-checklist.md` (this file)
- [ ] Decide UI framework:
  - [ ] React OR Solid (either is fine for M0)

Acceptance:
- `git status` clean; folders exist; docs committed.

---

## 1. Tauri App Skeleton

- [ ] Initialize Tauri app in `/src-tauri`
- [ ] Configure dev command to run UI + Tauri together
- [ ] Add a single window with a “grid page” route/screen

Acceptance:
- Running dev command opens Noviforma window with UI chrome visible.

---

## 2. UI Layout (DOM Panels + GPU Viewport)

- [ ] Build the basic layout:
  - [ ] Left panel (placeholder): “Project / Tags / Shots”
  - [ ] Center: **GPU viewport container** (a single element reserved for the GPU surface)
  - [ ] Right panel (placeholder): “Inspector”
- [ ] Add a scroll model for the center viewport:
  - [ ] Track `scrollTop`
  - [ ] Track viewport width/height
  - [ ] Track devicePixelRatio
- [ ] Add a simple “tile layout” calculator:
  - Inputs: viewport size, scrollTop, tileSize, gutter, totalItemCount
  - Output: list of visible tile rects `{ id, x, y, w, h }`

Acceptance:
- Scrolling updates a visible-tiles count label in the UI (even before GPU rendering).

---

## 3. IPC Contract: UI → Rust Renderer

- [ ] Create IPC command list:
  - [ ] `noviforma_renderer_set_viewport(width, height, dpr)`
  - [ ] `noviforma_renderer_set_visible_tiles(payload)`
- [ ] Define payload shape for M0:
  - [ ] `VisibleTilesPayload { tiles: [{ id: u32, x: f32, y: f32, w: f32, h: f32 }] }`
- [ ] Implement a UI batching strategy:
  - [ ] Debounce tile updates to once per animation frame (or max 60Hz)
  - [ ] Only send updates when:
    - scroll changes
    - viewport changes
    - tile size changes
- [ ] Implement a “tile count stress” control in UI:
  - [ ] Total items slider: 1k → 100k
  - [ ] Tile size slider: 96 → 256

Acceptance:
- UI is able to call the Tauri commands without errors and logs calls during scroll/resize.

---

## 4. Renderer Crate Skeleton (noviforma-renderer)

- [ ] Create crate `/crates/noviforma-renderer`
- [ ] Create structure:
  - [ ] `lib.rs`
  - [ ] `renderer.rs` (public API)
  - [ ] `state.rs` (wgpu device/queue/surface setup)
  - [ ] `pipelines/grid.rs`
  - [ ] `resources/buffers.rs`
  - [ ] `resources/textures.rs` (placeholder for later)
  - [ ] `types.rs`
  - [ ] `stats.rs`

Acceptance:
- The crate builds and exposes a `Renderer` type with stubbed methods.

---

## 5. wgpu Initialization and Surface Wiring

- [ ] Create renderer thread ownership model:
  - [ ] Renderer is created once on app start
  - [ ] Renderer owns:
    - wgpu instance
    - adapter
    - device
    - queue
    - surface
    - surface config
- [ ] Implement `resize(width, height, dpr)`:
  - [ ] Reconfigure surface
  - [ ] Update viewport uniform

Acceptance:
- Resizing the window does not crash; surface reconfigures cleanly.

---

## 6. M0 Grid Pipeline (Instanced Quads)

- [ ] Define unit quad vertex buffer (two triangles):
  - [ ] Positions in local quad space (centered or top-left)
  - [ ] UVs optional for M0 (can be omitted)
- [ ] Define `TileInstance` struct:
  - [ ] `x, y, w, h` in pixels
  - [ ] `r, g, b, a` color
- [ ] Create instance buffer allocation strategy:
  - [ ] Allocate for max visible tiles expected (e.g., 10k instances)
  - [ ] Realloc if needed
- [ ] Create viewport uniform:
  - [ ] width, height in pixels
  - [ ] Convert pixel coords → clip space in shader
- [ ] Write WGSL shader:
  - Vertex:
    - convert each instance rect into clip space
    - output color
  - Fragment:
    - output solid color
- [ ] Draw call:
  - [ ] set pipeline
  - [ ] bind uniform
  - [ ] set vertex buffer + instance buffer
  - [ ] `draw(0..6, 0..instance_count)`

Acceptance:
- The viewport shows a stable grid of colored tiles (no textures yet).

---

## 7. Visible Tile Updates → Instance Buffer Upload

- [ ] Implement `set_visible_tiles(payload)`:
  - [ ] Convert payload tiles into `Vec<TileInstance>`
  - [ ] Assign deterministic colors per id (e.g., hash id → color) to visually confirm stability
- [ ] Upload instance buffer each update:
  - [ ] `queue.write_buffer(instance_buffer, 0, bytes)`
- [ ] Ensure only visible tiles are uploaded and drawn:
  - [ ] instance_count == visible tiles length

Acceptance:
- Scrolling causes tiles to update correctly, and the visual pattern is stable and deterministic.

---

## 8. Render Loop Integration

- [ ] Run a render loop at vsync:
  - [ ] acquire swapchain frame
  - [ ] begin render pass
  - [ ] clear background
  - [ ] draw instanced tiles
  - [ ] submit
- [ ] Handle surface errors:
  - [ ] Lost → reconfigure
  - [ ] OutOfMemory → exit gracefully
  - [ ] Timeout → retry next frame

Acceptance:
- The app runs for 5+ minutes without crashing while scrolling/resizing.

---

## 9. Perf HUD (Minimal but Useful)

- [ ] Add counters:
  - [ ] FPS
  - [ ] frame time (ms)
  - [ ] visible tile count
  - [ ] last instance upload time (ms)
- [ ] Emit perf stats event from Rust → UI:
  - [ ] `noviforma_perf_stats { fps, frame_ms, visible_tiles, upload_ms }`
- [ ] Display perf HUD overlay in UI

Acceptance:
- HUD updates at least once per second and reflects visible tile changes.

---

## 10. Stress & Stability Tests (Manual)

- [ ] Tile stress:
  - [ ] Total items: 100k
  - [ ] Tile size: 128
  - [ ] Scroll continuously for 60 seconds
- [ ] Resize stress:
  - [ ] Resize window rapidly for 15 seconds
- [ ] DPI stress (if possible):
  - [ ] Test at 100% and 150% scaling

Acceptance:
- No crashes, no major stutters, no progressive slowdown over time.

---

## 11. M0 Cleanup & Hardening

- [ ] Add structured logging:
  - [ ] renderer init
  - [ ] resize events
  - [ ] surface errors
  - [ ] visible tile update rates
- [ ] Add a “safe mode” fallback:
  - [ ] if GPU init fails, show a clear UI error panel
- [ ] Pin versions for critical crates:
  - [ ] tauri
  - [ ] wgpu
  - [ ] winit (if used)
- [ ] Document how to run:
  - [ ] `README.md` with dev and build steps

Acceptance:
- A teammate can clone and run the M0 prototype with minimal setup friction.

---

## Optional M0+ (If M0 is Solid)

- [ ] Add tile selection highlight (GPU overlay rectangle)
- [ ] Add keyboard navigation (arrow keys)
- [ ] Add hover state (tile border)
- [ ] Add simple camera pan/zoom (viewer-style transform) for the grid

Acceptance:
- Interaction features work without lowering render stability.

---

## Notes: M0 Guardrails

- No media decoding.
- No DB.
- No thumbnails.
- No node graph.
- The only job is proving: UI computes visible tiles, renderer draws them fast via instancing.
