# Win95 Code Card

An external paintSMYS action plugin that creates a Windows 95-style code window from Python, JavaScript, or TypeScript source. Shiki tokenizes the source with its `dark-plus` theme; the plugin converts token colors into ordinary `TextObject.runs` and builds the rest of the window from rectangles and text.

## Install

Copy this entire directory into paintSMYS's plugin directory and restart the app:

```text
<app.getPath('userData')>/plugins/code-card/
```

The package is ready to install: `manifest.json` points to the prebuilt, self-contained `index.js`. The installed plugin does not need npm, a network connection, or a paintSMYS rebuild. The code card is stored as regular scene objects and remains editable, saveable, undoable, and exportable after the plugin is removed.

## Build the bundle

From the repository root, run:

```sh
npm run build:plugin:code-card
```

The source is in `src/index.js`; `scripts/build.mjs` bundles only Shiki's core, the Python/JavaScript/TypeScript grammars, the `dark-plus` theme, and Shiki's JavaScript regex engine into the classic-script entry point. There are no dynamic imports, WASM files, HTML rendering, or network requests in the installed package. The bundle runs in the existing sandboxed Worker under the current CSP.

## Input and layout

The form accepts a window title, language, and source code. Line endings are normalized to LF before token offsets are calculated. The code keeps its spaces, tabs, Unicode, blank lines, and indentation. The card centers on the current Artboard and shrinks the code font only to 11 px; source that still cannot fit produces a clear error instead of being clipped. Long titles that cannot fit beside the title bar buttons also produce an error.
