# Changelog

## Unreleased

- Added Text objects, editable object properties, a classic color palette, Undo/Redo, Artboard zoom and pan, and PNG export.
- Added local Desktop action plugins and host-rendered forms, with Win95 Window and syntax-highlighted Code Card examples.
- Updated Electron to 42.11.16 to address high-severity Electron advisories affecting the previous runtime.
- Added a Russian project README, a real Desktop screenshot, and installation notes for both example plugins.

## 2026-10-31 — `style: style border window`

- Linux Electron windows use `frame: false`, replacing the host window decoration with the editor's Windows 95 style title bar. Windows builds keep their native frame.
- A dedicated `desktop.html` entrypoint mounts the title bar only in the Linux desktop renderer. The title area supports dragging and double-click maximize through `-webkit-app-region`.
- Minimize, maximize/restore, and close buttons call narrow preload methods. The main process handles those IPC actions and reports maximize state so the button icon can update.
