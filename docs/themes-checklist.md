# Look checklist

Every part of jEditor: in its own look on each platform (the Windows app, the Mac app with and without macOS 26's own toolbar, Linux, a browser) and in every theme (the Windows app). Written by `node design/themes/audit.js`, which opens each screen at 1280×800, 1024×640 and 800×600 with comfortable density, and checks each part for: words or buttons off screen or cut off; anything under a theme's title bar; buttons with neither words nor an icon; words or icons spilling out of their button; buttons over each other; words cut off without "…"; words in the wrong font; files that aren't there. Run it again after changing how anything looks.

The platforms' own fonts aren't on the machine it runs on: Inter stands in for Segoe UI and SF (a little wider, so what fits here fits there), DejaVu Sans for Linux and a browser.

✓ nothing found · ⚠ n problems (listed below) · — not on screen there

Checked 2026-10-23.


## Main window

| Part | Windows | Mac | Mac, macOS 26 | Linux | Web | Royale | Noir | Red | Finder | Aperture | 1984 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Title bar | — | — | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Menu bar | — | — | — | — | — | ✓ | ✓ | ✓ | — | — | ✓ |
| A menu, open | — | — | — | — | — | ✓ | ✓ | ✓ | — | — | ✓ |
| Toolbar | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Toolbar, with every button on it | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Toolbar, with every button under More | ⚠ 3 | ⚠ 2 | — | ⚠ 1 | ⚠ 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Folder bar and search | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Folder list | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ⚠ 1 | ⚠ 1 | ⚠ 1 |
| Photos · Adjust · Paint, sidebar open | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| Photos · Adjust · Paint chip, sidebar closed | ✓ | ✓ | — | ✓ | ✓ | — | — | — | — | — | — |
| Thumbnails | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| What's selected (pane or foot bar) | ✓ | ✓ | ✓ | ✓ | ✓ | ⚠ 1 | ⚠ 1 | ⚠ 1 | ✓ | ✓ | ✓ |
| Thumbnail size | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Photo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Previous, rotate, next | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Film strip | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Status bar | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Right-click menu | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Note (toast) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Info | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Undo history | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Start page | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Settings

| Part | Windows | Mac | Mac, macOS 26 | Linux | Web | Royale | Noir | Red | Finder | Aperture | 1984 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Window and pages | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Theme gallery | — | — | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Rows, switches, lists | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Dialogs

| Part | Windows | Mac | Mac, macOS 26 | Linux | Web | Royale | Noir | Red | Finder | Aperture | 1984 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Are you sure? | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| A name to type | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Rename | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Export | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Move to… | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| New blank image | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Keyboard shortcuts | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| What's new | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Scan window | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Duplicates

| Part | Windows | Mac | Mac, macOS 26 | Linux | Web | Royale | Noir | Red | Finder | Aperture | 1984 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Head | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Foot | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Crop

| Part | Windows | Mac | Mac, macOS 26 | Linux | Web | Royale | Noir | Red | Finder | Aperture | 1984 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Head | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Zoom | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tools along the foot | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ⚠ 1 | ⚠ 1 | ⚠ 2 |

## Adjust

| Part | Windows | Mac | Mac, macOS 26 | Linux | Web | Royale | Noir | Red | Finder | Aperture | 1984 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Head and its buttons | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Mode switch | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Mode switch menu | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Histogram, levels, looks | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Sliders, curve, mixer, grading, masks, spots, detail | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Strip of photos | ⚠ 3 | ⚠ 3 | ⚠ 3 | ⚠ 3 | ⚠ 3 | ⚠ 3 | ⚠ 3 | ⚠ 3 | ⚠ 3 | ⚠ 3 | ⚠ 3 |

## Paint

| Part | Windows | Mac | Mac, macOS 26 | Linux | Web | Royale | Noir | Red | Finder | Aperture | 1984 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Head and its buttons | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tool options (brush) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tool options (text) | ✓ | ✓ | ✓ | ✓ | ✓ | ⚠ 1 | ⚠ 1 | ⚠ 1 | ✓ | ✓ | ✓ |
| Tools | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Colours and layers | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Checked by hand

What the script can't see. Tick each on the real app.

### jEditor's own look

| | Windows | Mac | Mac, macOS 26 | Linux | Web |
|---|:-:|:-:|:-:|:-:|:-:|
| In the real fonts: Segoe UI, SF, the desktop's | ☐ | ☐ | ☐ | ☐ | ☐ |
| With larger system text (Windows: Text size; Mac and Linux: larger text) | ☐ | ☐ | ☐ | ☐ | ☐ |
| The window: dragged, maximised, resized, snapped | ☐ | ☐ | ☐ | ☐ | — |
| The traffic lights cover nothing, and the window drags by its top | — | ☐ | — | — | — |
| macOS 26's own toolbar (Liquid Glass) holds the top row, nothing under it | — | — | ☐ | — | — |
| Mica and Acrylic behind the window | ☐ | — | — | — | — |
| Installed as an app (the browser's Install) | — | — | — | — | ☐ |
| Touch and a pen | ☐ | — | — | — | ☐ |

### Themes

| | Royale | Noir | Red | Finder | Aperture | 1984 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Windows: the title bar drags the window, double-click maximises, the top edge resizes, Snap still works | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Windows: minimise, maximise and close in the title bar; the maximised window keeps its edges on screen | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Menus from the keyboard (Alt, arrows, Enter, Esc) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Tooltips (drawn by Windows, not the theme) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Import from a camera or card | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Let jEditor open your photos (permissions) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Stored projects | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| A folder that's already there (Move to…) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Part of a project (order prompt) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Camera window | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Drag and drop onto the window | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| A real scan: preview, boxes, the photos coming in | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Photos picked one by one (the Save… bar) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

## Problems found

### Windows

- **Main window · Toolbar, with every button under More** (1024×640) off screen: button#btn-customize "Settings" is cut off by body
- **Main window · Toolbar, with every button under More** (800×600, comfortable) off screen: button#btn-shortcuts "Keyboard shortcuts" is cut off by body
- **Main window · Toolbar, with every button under More** (800×600, comfortable) off screen: button#btn-whatsnew "What's new" is cut off by body
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Snow line.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Station.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Valley.jpg" shows nothing

### Mac

- **Main window · Toolbar, with every button under More** (800×600, comfortable) off screen: button#btn-whatsnew "What's new" is cut off by body
- **Main window · Toolbar, with every button under More** (800×600, comfortable) off screen: button#btn-customize "Settings" is cut off by body
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Snow line.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Station.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Valley.jpg" shows nothing

### Mac, macOS 26

- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Snow line.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Station.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Valley.jpg" shows nothing

### Linux

- **Main window · Toolbar, with every button under More** (800×600, comfortable) off screen: button#btn-customize "Settings" is cut off by body
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Snow line.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Station.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Valley.jpg" shows nothing

### Web

- **Main window · Toolbar, with every button under More** (800×600, comfortable) off screen: button#btn-customize "Settings" is cut off by body
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Snow line.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Station.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Valley.jpg" shows nothing

### Royale

- **Main window · What's selected (pane or foot bar)** (1280×800) spills: span#selection-count "1 selected" spills 25px out of button#btn-clear-selection "Clear the selection"
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Snow line.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Station.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Valley.jpg" shows nothing
- **Paint · Tool options (text)** (800×600, comfortable) off screen: span.paint-opt "Click where the text goes; Ctrl+Enter pu" is cut off by body

### Noir

- **Main window · What's selected (pane or foot bar)** (1280×800) spills: span#selection-count "1 selected" spills 25px out of button#btn-clear-selection "Clear the selection"
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Snow line.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Station.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Valley.jpg" shows nothing
- **Paint · Tool options (text)** (800×600, comfortable) off screen: span.paint-opt "Click where the text goes; Ctrl+Enter pu" is cut off by body

### Red

- **Main window · What's selected (pane or foot bar)** (1280×800) spills: span#selection-count "1 selected" spills 25px out of button#btn-clear-selection "Clear the selection"
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Snow line.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Station.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Valley.jpg" shows nothing
- **Paint · Tool options (text)** (800×600, comfortable) off screen: span.paint-opt "Click where the text goes; Ctrl+Enter pu" is cut off by body

### Finder

- **Main window · Folder list** (1280×800) spills: span "USB drive · disc · copies" spills 15px out of button.btn.secondary "Copy it to a USB drive or card, burn it "
- **Crop · Tools along the foot** (800×600, comfortable) off screen: button#crop-save "Save (Enter)" is cut off by body
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Snow line.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Station.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Valley.jpg" shows nothing

### Aperture

- **Main window · Folder list** (1280×800) spills: span "USB drive · disc · copies" spills 15px out of button.btn.secondary "Copy it to a USB drive or card, burn it "
- **Crop · Tools along the foot** (800×600, comfortable) off screen: button#crop-save "Save (Enter)" is cut off by body
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Snow line.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Station.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Valley.jpg" shows nothing

### 1984

- **Main window · Folder list** (1280×800) spills: span "USB drive · disc · copies" spills 35px out of button.btn.secondary "Copy it to a USB drive or card, burn it "
- **Crop · Tools along the foot** (800×600, comfortable) off screen: button#crop-save-next "Save, then crop the next photo (Shift+En" is cut off by body
- **Crop · Tools along the foot** (800×600, comfortable) off screen: button#crop-save "Save (Enter)" is cut off by body
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Snow line.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Station.jpg" shows nothing
- **Adjust · Strip of photos** (800×600, comfortable) no icon: button.mode-thumb "Valley.jpg" shows nothing
