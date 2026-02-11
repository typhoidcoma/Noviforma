# GPU Renderer Integration Status

## Current Status

The GPU renderer integration with Tauri has a **dependency version conflict** that prevents direct window rendering.

### The Problem

- **Tauri 1.x** uses `raw-window-handle 0.5`
- **wgpu 0.18+** requires `raw-window-handle 0.6`
- These versions are incompatible, preventing surface creation from Tauri's window

### What's Implemented

✅ **IPC Layer** - Complete
- `renderer_init` - Initializes renderer (currently returns stub)
- `renderer_resize` - Handles viewport resizing
- `renderer_update_tiles` - Converts TileData to TileInstance and triggers render

✅ **Selection State** - Complete
- Click handling with multi-select (Ctrl, Shift)
- Selection passed to backend via IPC
- Selected tiles brighten when rendered

✅ **Renderer Architecture** - Complete
- `noviforma-renderer` crate with wgpu pipeline
- Separate grid and viewer pipelines
- TileInstance with color/texture support
- Performance tracking

❌ **Actual GPU Rendering in Tauri** - Blocked
- Cannot create wgpu surface from Tauri 1.x window
- Surface creation requires compatible raw-window-handle versions

---

## Solutions

### Option 1: Upgrade to Tauri 2.0 (Recommended)

**Status**: Tauri 2.0 is stable as of December 2024

Tauri 2.0 uses `raw-window-handle 0.6`, making it compatible with modern wgpu versions.

**Steps**:
1. Upgrade `tauri` to `2.x` in `src-tauri/Cargo.toml`
2. Upgrade `@tauri-apps/api` to `2.x` in `apps/ui/package.json`
3. Update any breaking API changes (mostly in window management)
4. Test surface creation with updated dependencies

**Pros**:
- Native GPU rendering
- Full performance
- Clean architecture
- Future-proof

**Cons**:
- Migration effort for Tauri API changes
- Need to test all existing functionality

---

### Option 2: Offscreen Rendering + Canvas Blit

Render to an offscreen texture in Rust, then copy pixels to a JavaScript canvas via IPC.

**Architecture**:
```
Rust: wgpu → offscreen texture → pixel buffer
  ↓ IPC
Frontend: Uint8Array → Canvas2D.putImageData()
```

**Steps**:
1. Create offscreen wgpu surface (no window needed)
2. Render to texture
3. Read pixels to buffer
4. Send via IPC as base64 or SharedArrayBuffer
5. Draw to canvas in frontend

**Pros**:
- Works with Tauri 1.x
- No dependency upgrades needed

**Cons**:
- CPU copy overhead (GPU → CPU → IPC → Canvas)
- Latency increase
- Memory bandwidth intensive
- Not true "GPU-accelerated UI"

---

### Option 3: WebGPU in Frontend

Use WebGPU from JavaScript to render the grid directly in the browser.

**Architecture**:
```
Rust: Database → Asset data → IPC
  ↓
Frontend: WebGPU pipeline → Canvas rendering
```

**Steps**:
1. Implement grid shader in WGSL (reuse existing shaders)
2. Create WebGPU pipeline in TypeScript
3. Pass tile data from Rust via IPC
4. Render entirely in frontend

**Pros**:
- No dependency conflicts
- Leverages browser's GPU access
- Cross-platform (web, desktop)

**Cons**:
- WebGPU browser support still limited
- Duplicate rendering logic (Rust + TypeScript)
- Can't share textures between Rust and WebGPU easily

---

## Recommendation

**Upgrade to Tauri 2.0** (Option 1)

Tauri 2.0 is stable and solves the core version conflict. The migration effort is minimal compared to the long-term benefits of native GPU rendering.

### Migration Checklist

- [ ] Update `Cargo.toml` workspace to Tauri 2.0
- [ ] Update `package.json` to `@tauri-apps/api` 2.x
- [ ] Fix API breaking changes (check [Tauri 2.0 migration guide](https://v2.tauri.app/start/migrate/from-tauri-1/))
- [ ] Test window creation and IPC commands
- [ ] Verify surface creation with wgpu 0.20+
- [ ] Test GPU rendering with tile grid
- [ ] Verify selection highlighting works
- [ ] Test resize and zoom functionality

---

## Current Workaround

The IPC layer is fully functional and logs all commands. The UI works with mock rendering:

```rust
// src-tauri/src/commands/renderer.rs
pub fn renderer_update_tiles(payload: VisibleTilesPayload, ...) {
    // Converts TileData → TileInstance
    // Applies selection brightening
    // Would render if surface existed
    tracing::info!("Tiles: {}, Selected: {}", tiles.len(), selected.len());
}
```

Frontend calls these commands correctly, but actual rendering is stubbed until Tauri 2.0 migration.

---

## Timeline

1. **Now**: IPC layer complete, selection working, architecture proven
2. **Next**: Migrate to Tauri 2.0 (~2-4 hours)
3. **Then**: Connect wgpu surface and verify rendering (~1-2 hours)
4. **Finally**: Load textures and complete GPU integration (~2-3 hours)

**Total estimated effort**: 1-2 days for full GPU rendering in Tauri

---

## Testing the Standalone App

The `noviforma-app` crate uses `winit` directly and has full GPU rendering working:

```bash
cd crates/noviforma-app
cargo run --release
```

This proves the GPU renderer works correctly - it just needs Tauri 2.0 for window integration.

---

## References

- [Tauri 2.0 Release](https://v2.tauri.app/blog/tauri-2-0/)
- [Tauri 2.0 Migration Guide](https://v2.tauri.app/start/migrate/from-tauri-1/)
- [wgpu 0.20 Release Notes](https://github.com/gfx-rs/wgpu/blob/trunk/CHANGELOG.md#v020-2024-04-28)
- [raw-window-handle 0.6](https://docs.rs/raw-window-handle/0.6/raw_window_handle/)
