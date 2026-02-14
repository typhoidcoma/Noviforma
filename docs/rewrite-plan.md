# Noviforma Rewrite Plan

**Date:** 2026-02-14  
**Status:** Approved, execution in progress

## Direction

- Replace Solid + WebGPU frontend with React + Canvas2D.
- Keep Tauri + Rust backend as the execution authority.
- Add a node-based interactive system (React Flow UI + Rust DAG execution).
- Use FFmpeg for first-pass video processing support.
- Use big-bang cutover and fresh-start DB strategy.

## Locked Product Decisions

- Frontend migration: full rewrite now.
- Grid renderer: Canvas2D + custom virtualization.
- Node editor: React Flow.
- Graph execution: Rust job runtime with SQLite persistence.
- Media scope in first release: full image/video parity.
- Backward compatibility: fresh start (no DB migration).
- Release strategy: big-bang replacement.

## Execution Phases

1. **Foundation**
- Create React app (`apps/ui-react`) and make it the default frontend target.
- Preserve Tauri backend boot path and compile stability.

2. **Catalog + Canvas**
- Rebuild folder/asset/tag/shot UI in React.
- Implement Canvas2D grid viewport with virtualization and selection.
- Reconnect existing catalog IPC to new frontend.

3. **Graph Runtime**
- Add typed graph schema, validation, persistence, and run lifecycle in Rust.
- Add run events (progress/state/output ready) over Tauri events.

4. **Node Editor**
- Implement graph editor UX in React Flow.
- Add save/load/run/cancel controls and run status surfaces.

5. **Image + Video Nodes**
- Implement core image node set.
- Implement video node set backed by FFmpeg execution jobs.
- Add preview output routing for node outputs.

6. **Cutover Cleanup**
- Remove `apps/ui` Solid path.
- Remove obsolete WebGPU grid code and stale crates/docs.
- Keep one active architecture/doc path.

## Acceptance Criteria

- `npm run build` succeeds using `apps/ui-react`.
- `cargo check -p noviforma` succeeds with updated frontend dist path.
- React app launches through Tauri and displays:
  - left project panel,
  - center Canvas2D viewport,
  - right inspector panel,
  - node graph panel.
- Node graph workflows support save/load/run/preview once runtime phases complete.

## Current Progress

- Foundation phase started:
  - `apps/ui-react` scaffolded.
  - Root scripts switched to React app.
  - Tauri `frontendDist` switched to `apps/ui-react/dist`.
