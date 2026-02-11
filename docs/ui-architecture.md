# Noviforma UI Architecture

**Last Updated:** 2026-02-11
**Status:** Phase 1 Complete (Layout & IPC)

---

## Overview

Noviforma's UI is built with **Tauri + SolidJS**, providing a native desktop application with web-based rendering. The architecture separates concerns cleanly between:

- **Frontend**: SolidJS reactive UI (`apps/ui/`)
- **Backend**: Rust with IPC commands (`src-tauri/`)
- **Renderer**: wgpu GPU rendering (`crates/noviforma-renderer/`)

---

## Technology Stack

### Frontend
- **Framework**: SolidJS 1.9.11
- **Build Tool**: Vite 5.4.21
- **Language**: TypeScript
- **Styling**: CSS Modules (component-scoped)

### Backend
- **Desktop Framework**: Tauri 1.6
- **IPC**: Tauri Commands (Rust ↔ JavaScript)
- **State Management**: Tauri Managed State
- **Logging**: tracing + tracing-subscriber

### Rendering
- **GPU API**: wgpu (Vulkan/Metal/DX12)
- **Instance Limit**: 256 textures, 100K+ tiles
- **Performance**: 60 FPS sustained

---

## Component Hierarchy

```
App
├── ProjectBrowser (left panel)
│   ├── Files Tab
│   ├── Tags Tab
│   └── Shots Tab
│
├── GridViewport (center)
│   ├── Viewport Header (title, search, view modes)
│   ├── Grid Scroller (virtual scrolling)
│   └── Canvas Element (GPU rendering target)
│
└── Inspector (right panel)
    ├── Empty State (no selection)
    ├── Single Asset View (details, tags, notes)
    └── Multi-Select View (batch operations)

StressControls (debug panel in left sidebar)
```

---

## File Structure

```
apps/ui/
├── src/
│   ├── components/
│   │   ├── GridViewport.tsx       # Virtual scrolling viewport
│   │   ├── GridViewport.css       # Viewport styles
│   │   ├── ProjectBrowser.tsx     # Files/Tags/Shots browser
│   │   ├── ProjectBrowser.css     # Browser styles
│   │   ├── Inspector.tsx          # Asset details panel
│   │   ├── Inspector.css          # Inspector styles
│   │   ├── StressControls.tsx     # Debug controls
│   │   └── StressControls.css     # Controls styles
│   │
│   ├── lib/
│   │   ├── viewport.ts            # Viewport calculations
│   │   └── tauri.ts               # IPC wrapper functions
│   │
│   ├── App.tsx                    # Root component
│   ├── App.css                    # App layout styles
│   ├── index.tsx                  # Entry point
│   └── styles.css                 # Global styles
│
├── index.html                     # HTML template
├── vite.config.ts                 # Vite configuration
├── tsconfig.json                  # TypeScript config
└── package.json                   # Dependencies

src-tauri/
├── src/
│   ├── commands/
│   │   ├── mod.rs                 # Command module exports
│   │   └── renderer.rs            # Renderer IPC commands
│   │
│   ├── renderer_state.rs          # Renderer state manager
│   └── main.rs                    # Tauri app entry
│
├── tauri.conf.json                # Tauri configuration
└── Cargo.toml                     # Rust dependencies
```

---

## Data Flow

### 1. UI → Rust (IPC Commands)

```typescript
// Frontend (TypeScript)
import { rendererInit, rendererResize, rendererUpdateTiles } from './lib/tauri';

// Initialize renderer
await rendererInit();

// Resize viewport
await rendererResize(width, height, dpr);

// Update visible tiles
await rendererUpdateTiles({
  tiles: [{ id, x, y, w, h }, ...],
  viewport_w: 1920,
  viewport_h: 1080,
  dpr: 1.5
});
```

```rust
// Backend (Rust)
#[tauri::command]
pub fn renderer_resize(
    width: f32,
    height: f32,
    dpr: f32,
    state: State<'_, RendererState>,
) -> Result<(), String> {
    let physical_width = (width * dpr) as u32;
    let physical_height = (height * dpr) as u32;
    state.resize(physical_width, physical_height)
}
```

### 2. Rust → UI (Events)

**Not yet implemented.** Future events:
- `asset_indexed` - New asset discovered
- `thumbnail_ready` - Thumbnail generated
- `render_stats` - FPS, frame times
- `selection_changed` - Backend-driven selection

### 3. State Management

**Current State (SolidJS Signals):**
```typescript
const [totalItems, setTotalItems] = createSignal(1000);
const [tileSize, setTileSize] = createSignal(128);
const [selectedAssets, setSelectedAssets] = createSignal<number[]>([]);
const [viewportWidth, setViewportWidth] = createSignal(0);
const [scrollTop, setScrollTop] = createSignal(0);
```

**Future State (Context API):**
- `ProjectContext` - Current project, roots, database
- `SelectionContext` - Selected assets, clipboard
- `ViewContext` - Zoom, filters, view mode
- `TagContext` - Tag definitions, filters

---

## IPC Commands

### Implemented

| Command | Parameters | Description |
|---------|-----------|-------------|
| `renderer_init` | `window: Window` | Initialize GPU renderer with Tauri window |
| `renderer_resize` | `width, height, dpr` | Resize renderer viewport |
| `renderer_update_tiles` | `VisibleTilesPayload` | Update visible tiles for rendering |

### Planned (M1-M3)

| Command | Parameters | Description |
|---------|-----------|-------------|
| `scan_roots` | `roots: Vec<String>` | Scan directories for assets |
| `query_assets` | `query: AssetQuery` | Query database for assets |
| `set_asset_tags` | `asset_ids, tags` | Add/remove tags |
| `create_shot` | `name, parent` | Create new shot |
| `assign_to_shot` | `shot_id, asset_ids` | Assign assets to shot |
| `load_thumbnail` | `asset_id` | Load thumbnail into GPU |
| `enter_viewer` | `asset_id` | Enter fullscreen viewer mode |

---

## Component API Reference

### GridViewport

**Props:**
```typescript
interface GridViewportProps {
  totalItems: number;    // Total number of assets
  tileSize: number;      // Base tile size (pixels)
}
```

**Responsibilities:**
- Calculate visible tiles based on scroll position
- Send IPC messages to update renderer
- Handle scroll and resize events
- Display viewport statistics

**Future Enhancements:**
- Selection handling (click, shift-click, ctrl-click)
- Context menu on right-click
- Keyboard navigation (arrow keys, home, end)
- Drag selection rectangle

---

### Inspector

**Props:**
```typescript
interface InspectorProps {
  selectedAssets: number[];  // Selected asset IDs
  totalAssets: number;       // Total asset count
}
```

**Responsibilities:**
- Display asset metadata
- Show/edit tags
- Show/edit notes
- Batch operations for multi-select

**Future Enhancements:**
- Real asset data from database
- Tag autocomplete
- Thumbnail preview
- Version history
- Shot assignment UI

---

### ProjectBrowser

**Props:**
```typescript
interface ProjectBrowserProps {
  // Future: filtering, navigation callbacks
}
```

**Responsibilities:**
- Browse file tree (roots, folders)
- Filter by tags
- Navigate shots
- Trigger asset scanning

**Future Enhancements:**
- Real file tree from database
- Tag filtering (click tag → filter grid)
- Shot navigation (click shot → show assets)
- Root path management (add, remove)

---

## Styling Guidelines

### Color Palette

```css
/* Backgrounds */
--bg-darkest: #0a0a0a;    /* Canvas background */
--bg-dark: #1a1a1a;       /* Main background */
--bg-medium: #222;        /* Panel headers */
--bg-light: #2a2a2a;      /* Input backgrounds */

/* Borders */
--border-subtle: #333;    /* Panel dividers */
--border-medium: #444;    /* Input borders */

/* Text */
--text-primary: #e0e0e0;  /* Main text */
--text-secondary: #aaa;   /* Secondary text */
--text-tertiary: #888;    /* Labels, hints */
--text-disabled: #666;    /* Disabled text */

/* Accents */
--accent-primary: #4a90e2;  /* Primary actions */
--accent-success: #6c6;     /* Success states */
--accent-warning: #fc6;     /* Warning states */
--accent-danger: #e74c3c;   /* Danger states */
```

### Component Patterns

**Button Hierarchy:**
```css
.btn-primary   { background: #4a90e2; }  /* Main actions */
.btn-secondary { background: #2a2a2a; }  /* Secondary actions */
.btn-icon      { background: none; }     /* Icon-only buttons */
```

**Spacing System:**
```css
--space-xs: 4px;
--space-sm: 8px;
--space-md: 12px;
--space-lg: 16px;
--space-xl: 24px;
```

---

## Performance Considerations

### Virtual Scrolling

The `GridViewport` uses virtual scrolling to render only visible tiles:

```typescript
// Calculate visible range
const start_row = (scrollTop / effectiveTileSize).floor();
const end_row = start_row + (viewportHeight / effectiveTileSize).ceil() + 1;

// Only render tiles in visible range
const visibleTiles = calculateVisibleTiles(start_row, end_row, ...);
```

**Benefits:**
- Supports 100K+ assets without DOM bloat
- Constant memory usage
- 60 FPS scrolling

### IPC Batching

Updates are batched using `requestAnimationFrame`:

```typescript
let rafId: number | null = null;
let pendingUpdate = false;

const scheduleUpdate = () => {
  if (pendingUpdate) return;
  pendingUpdate = true;

  rafId = requestAnimationFrame(async () => {
    pendingUpdate = false;
    await rendererUpdateTiles(payload);
  });
};
```

**Benefits:**
- One IPC call per frame (max 60/sec)
- Debounces rapid scroll events
- Reduces Rust ↔ JS overhead

---

## Development Workflow

### Running in Development

```bash
# Start Tauri dev server (runs Vite + Rust)
npm run tauri:dev

# Or separately:
cd apps/ui && npm run dev        # Vite only (localhost:5173)
cd src-tauri && cargo tauri dev  # Tauri + Vite
```

### Hot Reload Behavior

- **Frontend changes** (TS/TSX/CSS): Hot reload without restart
- **IPC commands** (Rust): Full rebuild + app restart
- **Renderer code** (wgpu): Full rebuild + app restart

### Building for Production

```bash
npm run tauri:build
```

Output: `src-tauri/target/release/bundle/`

---

## Future Integration Points

### M1 - Database Integration

**Add these IPC commands:**
```rust
#[tauri::command]
fn scan_roots(roots: Vec<String>, state: State<Database>) -> Result<(), String>;

#[tauri::command]
fn query_assets(query: AssetQuery, state: State<Database>) -> Result<Vec<Asset>, String>;
```

**Update components:**
- `ProjectBrowser`: Show real file tree from database
- `GridViewport`: Load real asset data
- `Inspector`: Display real metadata

---

### M2 - GPU Renderer Integration

**Complete the renderer initialization:**
```rust
// In renderer_state.rs
pub fn init(&self, window: &Window) -> Result<(), String> {
    // Get raw window handle from Tauri
    let raw_handle = window.hwnd()?;

    // Create wgpu surface from handle
    let surface = unsafe { create_surface_from_raw_handle(raw_handle) };

    // Initialize renderer
    let renderer = pollster::block_on(
        Renderer::new_from_surface(surface, width, height)
    )?;

    *self.renderer.lock().unwrap() = Some(renderer);
    Ok(())
}
```

**Enable canvas rendering:**
- Embed wgpu surface into `#gpu-grid-canvas`
- OR use child window approach

---

### M3 - Selection & Interaction

**Add click handlers:**
```typescript
const handleTileClick = (tileId: number, event: MouseEvent) => {
  if (event.ctrlKey) {
    // Toggle selection
    setSelectedAssets(prev =>
      prev.includes(tileId)
        ? prev.filter(id => id !== tileId)
        : [...prev, tileId]
    );
  } else if (event.shiftKey) {
    // Range selection
    const range = getRangeBetween(lastClicked, tileId);
    setSelectedAssets(range);
  } else {
    // Single selection
    setSelectedAssets([tileId]);
  }
};
```

**Wire to Inspector:**
- Inspector shows selected asset details
- Batch operations work on multi-select
- "Open in Viewer" launches viewer mode

---

## Testing Strategy

### Component Testing (Planned)

```typescript
import { render } from '@solidjs/testing-library';
import { Inspector } from './components/Inspector';

test('shows empty state when no selection', () => {
  const { getByText } = render(() =>
    <Inspector selectedAssets={[]} totalAssets={1000} />
  );
  expect(getByText('No assets selected')).toBeInTheDocument();
});
```

### IPC Testing (Planned)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_renderer_resize() {
        let state = RendererState::new();
        let result = state.resize(1920, 1080);
        assert!(result.is_ok());
    }
}
```

---

## Known Issues & Limitations

1. **No GPU rendering yet** - IPC commands are stubbed
2. **No selection interaction** - Grid doesn't respond to clicks yet
3. **Mock data only** - Tags, shots, files are placeholders
4. **No database** - Asset data not persisted
5. **No tag filtering** - Clicking tags doesn't filter grid
6. **No search** - Search input is non-functional

---

## Next Steps (Priority Order)

### Phase 2: Selection & Interaction
- [ ] Add click handlers to GridViewport
- [ ] Wire selection state to Inspector
- [ ] Implement keyboard navigation
- [ ] Add context menu (right-click)

### Phase 3: GPU Renderer Integration
- [ ] Complete `renderer_state.rs` initialization
- [ ] Get raw window handle from Tauri
- [ ] Create wgpu surface
- [ ] Render colored tiles from IPC data

### Phase 4: Database Integration (M1)
- [ ] Connect ProjectBrowser to database
- [ ] Load real assets in GridViewport
- [ ] Display real metadata in Inspector
- [ ] Implement thumbnail loading

### Phase 5: Tag & Shot System (M3)
- [ ] Implement tag filtering
- [ ] Add tag management (create, edit, delete)
- [ ] Implement shot creation
- [ ] Add asset assignment to shots

---

## Contributing Guidelines

### Adding New Components

1. Create component file: `apps/ui/src/components/ComponentName.tsx`
2. Create styles: `apps/ui/src/components/ComponentName.css`
3. Export from component (default export)
4. Import in `App.tsx` or parent component
5. Follow naming conventions: PascalCase for components, kebab-case for CSS classes

### Adding New IPC Commands

1. Define command in `src-tauri/src/commands/`
2. Register in `main.rs`: `.invoke_handler(tauri::generate_handler![...])`
3. Create wrapper in `apps/ui/src/lib/tauri.ts`
4. Call from components via wrapper
5. Document in this file

### Styling Best Practices

- Use component-scoped CSS files (no global styles except `styles.css`)
- Follow color palette (defined above)
- Use spacing system (--space-*)
- Test in both light and dark themes (future)
- Ensure 60 FPS performance (use transforms for animations)

---

## References

- [Tauri Documentation](https://tauri.app/v1/guides/)
- [SolidJS Documentation](https://www.solidjs.com/docs/latest)
- [wgpu Documentation](https://wgpu.rs/)
- [Noviforma Engineering Plan](./engineering.md)
- [Noviforma Design Spec](./design.md)

---

**Document Status:** Living document - update as architecture evolves
