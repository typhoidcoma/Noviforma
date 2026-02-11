# Noviforma Assets

This directory contains platform-specific application icons and other assets for Noviforma.

## App Icons

Icons are organized by platform in the [icons/](./icons/) directory:

### Windows 11 Icons

Location: [icons/windows11/](./icons/windows11/)

**Tile Logos:**
- `SmallTile.scale-*.png` - Small Start Menu tiles (71×71 to 284×284)
- `Square150x150Logo.scale-*.png` - Medium tiles (150×150 to 600×600)
- `Wide310x150Logo.scale-*.png` - Wide tiles (310×150 to 1240×600)
- `LargeTile.scale-*.png` - Large tiles (310×310 to 1240×1240)

**App Icons:**
- `Square44x44Logo.scale-*.png` - App icons (44×44 to 176×176)
- `Square44x44Logo.targetsize-*.png` - Target size variants (16×16 to 256×256)
- `Square44x44Logo.altform-unplated_targetsize-*.png` - Unplated variants
- `Square44x44Logo.altform-lightunplated_targetsize-*.png` - Light theme variants

**Store & Splash:**
- `StoreLogo.scale-*.png` - Store logos (50×50 to 200×200)
- `SplashScreen.scale-*.png` - Splash screens (620×300 to 2480×1200)

### Android Icons

Location: [icons/android/](./icons/android/)

- `android-launchericon-48-48.png` - LDPI (48×48)
- `android-launchericon-72-72.png` - MDPI (72×72)
- `android-launchericon-96-96.png` - HDPI (96×96)
- `android-launchericon-144-144.png` - XHDPI (144×144)
- `android-launchericon-192-192.png` - XXHDPI (192×192)
- `android-launchericon-512-512.png` - XXXHDPI (512×512)

### iOS Icons

Location: [icons/ios/](./icons/ios/)

Comprehensive set of iOS app icons from 16×16 to 1024×1024 pixels, covering all device sizes and resolutions:

- Standard sizes: 16, 20, 29, 32, 40, 50, 57, 58, 60, 64, 72, 76, 80, 87
- Large sizes: 100, 114, 120, 128, 144, 152, 167, 180, 192, 256, 512
- App Store: 1024×1024

### Icon Manifest

[icons/icons.json](./icons/icons.json) contains a complete manifest of all icon files with their sizes and paths. This manifest can be used by build tools to reference the correct icon for each platform and size.

## Using Icons in Tauri

Icons are configured in [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json):

```json
{
  "bundle": {
    "icon": [
      "../assets/icons/windows11/Square44x44Logo.targetsize-256.png",
      "../assets/icons/ios/1024.png",
      "../assets/icons/android/android-launchericon-512-512.png"
    ]
  }
}
```

Tauri automatically selects the appropriate icon for each platform during the build process.

## Icon Generation

If you need to regenerate or modify icons, use an icon generator tool that supports:
- Windows UWP/AppX icon formats
- Android adaptive icons
- iOS app icon sets
- Multiple DPI scales (100%, 125%, 150%, 200%, 400%)

Popular tools:
- [PWA Asset Generator](https://github.com/elegantapp/pwa-asset-generator)
- [Tauri Icon Plugin](https://tauri.app/v1/guides/features/icons/)
- [App Icon Generator](https://appicon.co/)

## Best Practices

1. **Source File**: Keep a high-resolution source file (2048×2048 or larger) in a vector format (SVG, AI, Sketch)
2. **Transparency**: Use transparent backgrounds for most icons (except splash screens)
3. **Safe Zone**: Keep important elements within the center 80% of the icon to account for masking
4. **Testing**: Test icons at all sizes to ensure they remain legible
5. **Consistency**: Maintain consistent visual style across all platforms

## Icon Design Guidelines

**Windows 11:**
- Use the Fluent Design System aesthetic
- Support both light and dark themes
- Consider plated vs. unplated variants

**Android:**
- Follow Material Design icon guidelines
- Use adaptive icons with foreground/background layers
- Test on various launcher backgrounds

**iOS:**
- Follow Human Interface Guidelines
- Avoid alpha transparency in corners (iOS adds its own masking)
- Ensure icons work on both light and dark backgrounds
