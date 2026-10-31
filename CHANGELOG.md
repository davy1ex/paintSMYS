# Changelog

## 2026-10-31 — `style: style border window`

- Linux Electron windows use `frame: false`, replacing the host window decoration with the editor's Windows 95 style title bar. Windows builds keep their native frame.
- A dedicated `desktop.html` entrypoint mounts the title bar only in the Linux desktop renderer. The title area supports dragging and double-click maximize through `-webkit-app-region`.
- Minimize, maximize/restore, and close buttons call narrow preload methods. The main process handles those IPC actions and reports maximize state so the button icon can update.
