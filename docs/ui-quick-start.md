# Noviforma UI Quick Start Guide

**For developers new to the project**

---

## 🚀 Getting Started (5 minutes)

### Prerequisites
```bash
# Check versions
node --version   # v18+ required
npm --version    # v9+ required
rustc --version  # 1.70+ required
```

### Installation
```bash
# Clone repo (if not already done)
git clone <repo-url>
cd Noviforma

# Install dependencies
npm install              # Root workspace
cd apps/ui && npm install  # UI dependencies
cd ../../src-tauri && cargo build  # Rust backend
```

### Run Development Server
```bash
# From project root
npm run tauri:dev

# This starts:
# - Vite dev server (localhost:5173)
# - Tauri app with hot reload
# - Rust backend compilation
```

**You should see:** Tauri window with three panels (Project Browser, Grid, Inspector)

---

## 📁 Project Structure (What's Where)

```
Noviforma/
├── apps/ui/                    # Frontend (SolidJS)
│   ├── src/
│   │   ├── components/         # UI components
│   │   ├── lib/                # Utilities, IPC
│   │   └── App.tsx             # Root component
│   └── package.json
│
├── src-tauri/                  # Backend (Tauri + Rust)
│   ├── src/
│   │   ├── commands/           # IPC command handlers
│   │   └── main.rs             # App entry point
│   └── Cargo.toml
│
├── crates/                     # Rust libraries
│   ├── noviforma-core/         # Database, indexing
│   ├── noviforma-renderer/     # wgpu GPU rendering
│   └── noviforma-app/          # Standalone app (legacy)
│
└── docs/                       # Documentation
    ├── ui-architecture.md      # Full architecture docs
    └── engineering.md          # Engineering plan
```

---

## 🎨 Making UI Changes

### Add a New Component

1. **Create component file:**
   ```typescript
   // apps/ui/src/components/MyComponent.tsx
   import { Component } from 'solid-js';
   import './MyComponent.css';

   interface MyComponentProps {
     title: string;
   }

   const MyComponent: Component<MyComponentProps> = (props) => {
     return (
       <div class="my-component">
         <h3>{props.title}</h3>
       </div>
     );
   };

   export default MyComponent;
   ```

2. **Create styles:**
   ```css
   /* apps/ui/src/components/MyComponent.css */
   .my-component {
     padding: 16px;
     background: #222;
     border-radius: 4px;
   }
   ```

3. **Use in App.tsx:**
   ```typescript
   import MyComponent from './components/MyComponent';

   <MyComponent title="Hello World" />
   ```

4. **Hot reload** automatically shows your changes!

---

## 🔌 Adding IPC Commands

### Frontend → Rust Communication

**1. Define Rust command:**
```rust
// src-tauri/src/commands/my_commands.rs
#[tauri::command]
pub fn my_command(param: String) -> Result<String, String> {
    tracing::info!("Received: {}", param);
    Ok(format!("Processed: {}", param))
}
```

**2. Register command:**
```rust
// src-tauri/src/main.rs
mod commands;
use commands::my_commands;

tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
        my_commands::my_command,  // Add here
    ])
```

**3. Create TypeScript wrapper:**
```typescript
// apps/ui/src/lib/tauri.ts
import { invoke } from '@tauri-apps/api/tauri';

export async function myCommand(param: string): Promise<string> {
  return await invoke('my_command', { param });
}
```

**4. Call from component:**
```typescript
import { myCommand } from '../lib/tauri';

const result = await myCommand('test');
console.log(result);  // "Processed: test"
```

---

## 🎯 Common Tasks

### Update Grid Tile Count
```typescript
// In App.tsx
const [totalItems, setTotalItems] = createSignal(5000);
```

### Change Tile Size
```typescript
// In App.tsx
const [tileSize, setTileSize] = createSignal(256);  // Default: 128
```

### Add New Tab to Project Browser
```typescript
// In ProjectBrowser.tsx
const [activeTab, setActiveTab] = createSignal<'files' | 'tags' | 'shots' | 'newtab'>('files');

<button
  class={`tab ${activeTab() === 'newtab' ? 'active' : ''}`}
  onClick={() => setActiveTab('newtab')}
>
  New Tab
</button>

{activeTab() === 'newtab' && (
  <div class="newtab-panel">
    {/* Your content */}
  </div>
)}
```

### Access Selected Assets
```typescript
// In App.tsx
const [selectedAssets, setSelectedAssets] = createSignal<number[]>([]);

// Set selection
setSelectedAssets([1, 5, 10]);

// Get selection
console.log(selectedAssets());  // [1, 5, 10]

// Clear selection
setSelectedAssets([]);
```

---

## 🐛 Debugging

### View Console Logs

**Frontend (Browser DevTools):**
```bash
# Right-click in Tauri window → Inspect Element
# Or press F12
```

**Backend (Terminal):**
```bash
# Rust logs appear in terminal where you ran `npm run tauri:dev`
tracing::info!("Debug message");
tracing::warn!("Warning message");
tracing::error!("Error message");
```

### Common Issues

**Port 5173 already in use:**
```bash
# Kill existing Vite server
npx kill-port 5173

# Or in PowerShell:
Get-Process -Id (Get-NetTCPConnection -LocalPort 5173).OwningProcess | Stop-Process
```

**Rust compilation errors:**
```bash
# Clean build
cd src-tauri
cargo clean
cargo build
```

**Hot reload not working:**
```bash
# Restart dev server
# Stop with Ctrl+C, then:
npm run tauri:dev
```

---

## 🎨 Styling Cheat Sheet

### Color Variables
```css
.my-element {
  background: #1a1a1a;     /* Main background */
  color: #e0e0e0;          /* Primary text */
  border: 1px solid #333;  /* Subtle border */
}
```

### Common Patterns
```css
/* Button */
.btn {
  padding: 10px 16px;
  background: #4a90e2;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn:hover {
  background: #357abd;
}

/* Input */
.input {
  padding: 8px 12px;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 13px;
}

.input:focus {
  outline: none;
  border-color: #4a90e2;
}

/* Panel */
.panel {
  background: #222;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 16px;
}
```

---

## 📦 Building for Production

```bash
# Create production build
npm run tauri:build

# Output location:
# src-tauri/target/release/bundle/
#   - Windows: .msi installer
#   - macOS: .dmg
#   - Linux: .deb, .AppImage
```

---

## 🧪 Testing (Coming Soon)

```typescript
// Component tests
import { render } from '@solidjs/testing-library';

test('renders component', () => {
  const { getByText } = render(() => <MyComponent title="Test" />);
  expect(getByText('Test')).toBeInTheDocument();
});
```

```rust
// IPC command tests
#[cfg(test)]
mod tests {
    #[test]
    fn test_my_command() {
        let result = my_command("test".to_string());
        assert!(result.is_ok());
    }
}
```

---

## 📚 Learn More

- **Full Architecture**: See `docs/ui-architecture.md`
- **Engineering Plan**: See `docs/engineering.md`
- **Tauri Docs**: https://tauri.app/
- **SolidJS Docs**: https://www.solidjs.com/
- **wgpu Docs**: https://wgpu.rs/

---

## 🚦 Current Status

✅ **Working:**
- Three-panel layout
- Project browser (Files/Tags/Shots tabs)
- Grid viewport with virtual scrolling
- Inspector panel (empty/single/multi states)
- IPC commands (init, resize, update_tiles)
- Hot reload development

🚧 **In Progress:**
- GPU rendering integration
- Selection state management
- Click handlers

❌ **Not Implemented:**
- Database integration
- Real asset loading
- Tag filtering
- Search functionality
- Shot management

---

## 💡 Tips

1. **Use TypeScript** - Catch errors before runtime
2. **Follow naming conventions** - PascalCase components, kebab-case CSS
3. **Keep components small** - Single responsibility principle
4. **Test in dev mode first** - Hot reload makes iteration fast
5. **Check terminal** - Rust compilation errors show there
6. **Use browser DevTools** - Inspect UI, check console
7. **Read architecture docs** - Understand before modifying

---

**Need help?** Check `docs/ui-architecture.md` for detailed information.
