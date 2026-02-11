# Noviforma

**Shot/Asset Browser + Node AI Workflow**

Noviforma is a Windows-first desktop application for browsing, organizing, and processing high-resolution media (8K images and video). Built with Tauri, Rust, and WebGPU for instant interaction and GPU-accelerated rendering.

## Features

- **GPU-Accelerated Grid** - Browse thousands of assets at 60 FPS with WebGPU rendering
- **Progressive Loading** - Placeholder → thumbnail → proxy → full-res workflow
- **Organization** - Shot/sequence structure with versioning, tags, notes, and ratings
- **Fast Search** - Instant filtering and search across large media libraries
- **Non-Destructive** - Metadata-driven workflow with derived outputs
- **Node-Based AI** - Simple node graph for AI generation and processing

## Tech Stack

- **Frontend**: SolidJS + TypeScript + WebGPU
- **Backend**: Rust + Tauri 2.0
- **Database**: SQLite (via noviforma-core)
- **Rendering**: WebGPU (browser-based GPU acceleration)

## Project Structure

```
noviforma/
├── apps/ui/              # SolidJS frontend
├── assets/icons/         # Platform-specific app icons
├── crates/               # Rust workspace crates
│   ├── noviforma-core/   # Core library (DB, indexing, thumbnails)
│   └── noviforma-app/    # Standalone app binary
├── src-tauri/            # Tauri backend
└── docs/                 # Design and engineering docs
```

## App Icons

Platform-specific icons are located in [assets/icons/](./assets/icons/):

- **Windows 11**: Tiles, logos, splash screens (various DPI scales)
- **Android**: Launcher icons (48px to 512px)
- **iOS**: App icons (16px to 1024px)
- **Manifest**: [icons.json](./assets/icons/icons.json) lists all variants

Icons are referenced in [src-tauri/tauri.conf.json](./src-tauri/tauri.conf.json) for bundle generation.

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

## Documentation

- [Design Specification](./docs/design.md) - Product goals, user stories, milestones
- [UI Architecture](./docs/ui-architecture.md) - Component structure, IPC, data flow
- [Engineering Plan](./docs/engineering.md) - Technical architecture and implementation
- [M0 Checklist](./docs/noviforma-m0-checklist.md) - GPU grid prototype milestone
- [Quick Start](./docs/ui-quick-start.md) - UI development guide

## Current Status

**Phase: M1 - Database Integration Complete**

- ✅ GPU grid viewport with WebGPU rendering
- ✅ Virtual scrolling for 100K+ assets
- ✅ SQLite database with asset indexing
- ✅ Thumbnail generation and caching
- ✅ Directory scanning and file watching
- ✅ App icons for all platforms
- 🚧 Selection and interaction (in progress)
- 🚧 Tag and shot system (planned)
- 🚧 Node graph workflow (planned)

## License

Copyright © 2026 Noviforma Team. All rights reserved.
