# Noviforma

**Shot/Asset Browser + Media Organization**

Noviforma is a Windows-first desktop application for browsing, organizing, and managing high-resolution media libraries. Built with Tauri v2, Rust, and WebGPU for instant interaction and GPU-accelerated rendering.

## Features

### Asset Management
- **GPU-Accelerated Grid** - Browse thousands of assets at 60 FPS with WebGPU canvas rendering
- **Lasso Selection** - Click-and-drag box selection with multi-select support
- **Directory Scanning** - Index folders recursively with automatic thumbnail generation
- **Smart Indexing** - Duplicate-aware insertion, deterministic ordering, incremental scans
- **Folder Organization** - Multi-folder support with per-folder asset counts

### Tagging & Organization
- **Custom Tags** - Create tags with custom colors, filter by multiple tags simultaneously
- **Color-Coded Tags** - Inline color picker for easy visual organization
- **Shot Management** - Organize assets into shots with sequences and status tracking
- **Asset Metadata** - Notes, ratings, and custom metadata on individual assets

### User Experience
- **Three-Panel Layout** - ProjectBrowser (folders/tags/shots) | Grid Viewport | Inspector (metadata)
- **Persistent Settings** - Grid columns, gutter size, panel widths stored in localStorage
- **Resizable Panels** - Drag-to-resize side panels with min/max constraints
- **Grid Reset** - Instant zoom/pan reset with keyboard shortcut (R key)
- **Real-Time Updates** - Live thumbnail progress, automatic grid refresh

## Tech Stack

- **Frontend**: SolidJS + TypeScript + WebGPU
- **Backend**: Rust + Tauri 2.0
- **Database**: SQLite (via noviforma-core)
- **Rendering**: WebGPU (browser-based GPU acceleration)

## Project Structure

```
noviforma/
├── apps/ui/              # SolidJS frontend
│   ├── src/
│   │   ├── components/   # GridViewport, ProjectBrowser, Inspector, Settings
│   │   ├── lib/          # database.ts (IPC wrappers), viewport.ts (grid math)
│   │   └── App.tsx       # Main app shell with layout and state
├── assets/icons/         # Platform-specific app icons
├── crates/               # Rust workspace crates
│   ├── noviforma-core/   # Core library
│   │   ├── database.rs   # SQLite schema, queries, migrations
│   │   ├── indexer.rs    # Asset metadata extraction
│   │   ├── scanner.rs    # Directory traversal
│   │   └── thumbs.rs     # Thumbnail generation with image-rs
│   └── noviforma-app/    # Standalone CLI binary
├── src-tauri/            # Tauri backend
│   ├── commands/         # database.rs, folders.rs (IPC command handlers)
│   ├── database_state.rs # Global state manager
│   └── main.rs           # Tauri app entry point
└── docs/                 # Design and engineering docs
```

## Database Schema

**Tables:**
- `folders` - Indexed directories with asset counts
- `assets` - Files with metadata (path, size, modified_at, indexed_at, folder_id, notes, rating)
- `tags` - User-defined tags with colors
- `asset_tags` - Many-to-many relationship (asset ↔ tag)
- `shots` - Shot management with sequences and status
- `asset_shots` - Many-to-many relationship (asset ↔ shot)

**Migrations:** Schema version tracked via `PRAGMA user_version` with automatic migration on startup.

**Thumbnails:** Stored in `{app_data_dir}/databases/thumbnails/{asset_id}.webp` (256×256 WebP)

## App Icons

Platform-specific icons are located in [assets/icons/](./assets/icons/):

- **Windows 11**: Tiles, logos, splash screens (various DPI scales)
- **Android**: Launcher icons (48px to 512px)
- **iOS**: App icons (16px to 1024px)
- **Manifest**: [icons.json](./assets/icons/icons.json) lists all variants

Icons are referenced in [src-tauri/tauri.conf.json](./src-tauri/tauri.conf.json) for bundle generation.

## Getting Started

### First Launch

1. Launch Noviforma - database will be created at `%APPDATA%\com.noviforma.app\databases\noviforma.db`
2. Click **+** in the Files tab to add a directory
3. Select a folder containing images/videos
4. Wait for scanning and thumbnail generation to complete
5. Browse assets in the GPU-accelerated grid

### Organizing Your Library

**Folders:**
- Add multiple directories via the **+** button
- Click "Scan Assets" to rescan all folders for new files
- Click a folder name to filter assets by that folder

**Tags:**
- Switch to the **Tags** tab
- Click **+** to create a tag, choose a name and color
- Click a tag's color swatch to change it
- Click tag names to filter assets (multi-tag filtering supported)
- Assign tags to assets via the Inspector panel (right sidebar)

**Shots:**
- Switch to the **Shots** tab
- Create shots with optional sequence names
- Assign assets to shots for organization (e.g., "Shot_010", sequence "SEQ_A")
- Click a shot to filter the grid

**Settings:**
- Click the **⚙** button to open settings
- Adjust grid columns (0 = auto, 1-20 = fixed)
- Adjust gutter spacing between tiles
- Changes persist across sessions

## Development

### Prerequisites

- Node.js 18+ (for frontend)
- Rust 1.70+ (for backend)
- Windows 10/11 (primary platform)

### Running the App

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

### Project Commands

```bash
npm run dev          # Start Tauri dev server (frontend + backend)
npm run build        # Build production bundle
npm run tauri:dev    # Tauri development mode
npm run tauri:build  # Create release bundle
```

### Keyboard Shortcuts

- **R** - Reset grid zoom and pan to default view
- **Esc** - Clear selection
- **Click + Drag** - Lasso selection (box select)
- **Ctrl + Click** - Multi-select toggle (planned)

### Architecture Highlights

**IPC Layer:** Frontend calls Rust backend via Tauri commands (e.g., `dbScanDirectory`, `dbGenerateThumbnails`). All commands exposed through `apps/ui/src/lib/database.ts` wrappers.

**State Management:** SolidJS signals for reactive UI updates. Database state managed in Rust via `Arc<Mutex<DatabaseState>>` for thread-safe access.

**Grid Rendering:** WebGPU canvas with virtual scrolling. Only visible tiles are rendered. Grid calculations in `viewport.ts` handle layout math (columns, rows, tile positioning).

**Thumbnail Pipeline:**
1. Directory scan indexes files → SQLite
2. `ThumbnailGenerator` uses Rayon parallel processing
3. Images resized to 256×256 and saved as WebP
4. Frontend loads from `convertFileSrc(thumbnail_path)`

## Documentation

- [Design Specification](./docs/design.md) - Product goals, user stories, milestones
- [UI Architecture](./docs/ui-architecture.md) - Component structure, IPC, data flow
- [Engineering Plan](./docs/engineering.md) - Technical architecture and implementation
- [M0 Checklist](./docs/noviforma-m0-checklist.md) - GPU grid prototype milestone
- [Quick Start](./docs/ui-quick-start.md) - UI development guide

## Current Status

**Phase: M1 - Core Asset Management Complete**

### Completed Features ✅
- GPU grid viewport with WebGPU canvas rendering
- Lasso selection with click-and-drag box select
- SQLite database with schema migrations (v1 → v2 → v3)
- Thumbnail generation with Rayon parallel processing
- Directory scanning with duplicate detection (`INSERT OR IGNORE`)
- Folder management (add, scan, rescan, delete)
- Tag system with custom colors and multi-tag filtering
- Shot management with sequences and status tracking
- Settings modal with persistent configuration
- Asset inspector with metadata editing (notes, ratings)
- Three-panel layout with resizable panels
- Grid reset functionality (R key)
- Platform-specific app data directory (`AppData\Roaming\com.noviforma.app\databases\`)

### In Progress 🚧
- Batch operations (multi-select tag/shot assignment)
- Search and filtering improvements
- Asset versioning system

### Planned 📋
- Node graph workflow for AI processing
- Video playback and scrubbing
- Export and render queue

## License

Copyright © 2026 Noviforma Team. All rights reserved.
