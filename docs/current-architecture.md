# Noviforma Current Architecture (Implemented)

**Last verified:** 2026-02-14  
**Status:** Rewrite transition active (`src-tauri` + `apps/ui-react`)

This file tracks the architecture that is active right now in the repo.

## 1. Runtime Shape

- Frontend: React + TypeScript (`apps/ui-react`)
- Desktop host + IPC: Tauri v2 (`src-tauri`)
- Core domain/data: Rust crate `noviforma-core` (`crates/noviforma-core`)
- Viewport rendering (transition state): Canvas2D placeholder in React
- Storage/runtime backend: current SQLite + command surface in `src-tauri`

## 2. Active Entry Points

- Frontend entry: `apps/ui-react/src/main.tsx`
- Frontend shell: `apps/ui-react/src/App.tsx`
- Tauri backend entry: `src-tauri/src/main.rs`
- Tauri frontend dist path: `src-tauri/tauri.conf.json` -> `../apps/ui-react/dist`

Validation as of this update:
- `npm run build` succeeds in `apps/ui-react`
- `cargo check -p noviforma` succeeds

## 3. Frontend Transition Status

Implemented in new frontend:
- Three-panel + bottom graph layout
- Canvas2D viewport shell (`apps/ui-react/src/components/CanvasViewport.tsx`)
- React Flow graph shell in main app

Not yet migrated:
- Full folder/tag/shot browser functionality
- Full inspector behavior
- Existing database wrappers and feature-complete interactions from `apps/ui`
- Node run orchestration UI and live output previews

## 4. Backend Status

Current backend remains the existing database-centric command set:
- Command module: `src-tauri/src/commands/database.rs`
- State manager: `src-tauri/src/database_state.rs`
- Registration: `src-tauri/src/main.rs`

This backend is still authoritative until graph/job/media modules are added.

## 5. Legacy Paths Still Present

- `apps/ui` (Solid/WebGPU implementation) remains in repo but is no longer the active frontend target in root scripts/Tauri config.
- `crates/noviforma-app` remains non-compiling/legacy.

## 6. Source of Truth Docs

- Current runtime view: `docs/current-architecture.md` (this file)
- Rewrite execution plan: `docs/rewrite-plan.md`
