# Noviforma

Windows-first desktop app for media cataloging and node-based processing workflows.

## Current Direction

Noviforma is in active architecture transition:

- Frontend is migrating to **React + Canvas2D** (`apps/ui-react`)
- Node editor is being built with **React Flow**
- Backend remains **Tauri v2 + Rust** (`src-tauri`, `crates/noviforma-core`)
- Video node pipeline target is **FFmpeg-backed Rust jobs**

## Current Repo Status

- Active frontend path: `apps/ui-react`
- Legacy frontend path still present: `apps/ui` (not active in root scripts/Tauri dist)
- Active backend path: `src-tauri`

## Project Structure

```text
noviforma/
  apps/
    ui-react/              # Active React frontend
    ui/                    # Legacy Solid/WebGPU frontend (transition period)
  crates/
    noviforma-core/        # Database, scanning, thumbnail generation
    noviforma-app/         # Legacy crate (stale)
  src-tauri/               # Tauri app host and command registration
  docs/
    current-architecture.md
    rewrite-plan.md
```

## Development

### Prerequisites

- Node.js 18+
- Rust 1.70+
- Windows 10/11

### Install

```bash
# root tools (tauri cli)
npm install

# active frontend
cd apps/ui-react
npm install
```

### Run

```bash
# from repo root
npm run tauri:dev
```

### Build

```bash
# frontend
cd apps/ui-react
npm run build

# backend compile check
cd ../..
cargo check -p noviforma
```

## Documentation

- `docs/current-architecture.md` - current implemented runtime state
- `docs/rewrite-plan.md` - approved rewrite plan and execution phases

## License

Copyright (c) 2026 Noviforma Team.
