# paintSMYS

Локальный объектный графический редактор. Ближайшая продуктовая цель — первый внешний плагин; roadmap, продуктовые требования и целевая архитектура описаны в [`docs/ROADMAP.md`](docs/ROADMAP.md), [`docs/PRD.md`](docs/PRD.md) и [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Для установки локальных Desktop action-плагинов и контракта API v0 смотри [`docs/PLUGIN_API_V0.md`](docs/PLUGIN_API_V0.md); внешний пример находится в [`examples/plugins/win95-window`](examples/plugins/win95-window).

`src/app` содержит Electron main/preload, browser entrypoint и общий React App. `src/editor` — общий UI редактора. Electron и Browser собираются отдельно из корневого `index.html`.

## Разработка

Требуется Node.js 22.12 или новее.

```bash
npm install
npm run dev:desktop
```

Для Web App запусти `npm run dev:web` в отдельном терминале.

Web-версия открывает папку, в корне которой находится `project.json`, через файловый диалог браузера. Если Windows-браузер отклоняет путь `\\wsl.localhost\...` как системную папку, выбери копию проекта в обычной папке Windows, например `Documents`. Для проекта, который остаётся в файловой системе WSL, используй Desktop-версию.

## Сборка

```bash
npm run build
npm run package:dir
```

`npm run build` проверяет TypeScript и собирает Electron в `dist/main`, `dist/preload`, `dist/renderer`, а Browser — в `dist/web`. `npm run package:dir` создаёт распакованную Desktop-сборку; для установщиков доступны `package:win`, `package:linux` и `package:mac`.
