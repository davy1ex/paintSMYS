# paintSMYS

Локальный объектный графический редактор. Продуктовые требования и целевая архитектура описаны в [`docs/PRD.md`](docs/PRD.md) и [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

`src/app` содержит Electron main/preload, browser entrypoint и общий React App. `src/editor` — общий UI редактора. Electron и Browser собираются отдельно из корневого `index.html`.

## Разработка

Требуется Node.js 22.12 или новее.

```bash
npm install
npm run dev:desktop
```

Для Web App запусти `npm run dev:web` в отдельном терминале.

## Сборка

```bash
npm run build
npm run package:dir
```

`npm run build` проверяет TypeScript и собирает Electron в `dist/main`, `dist/preload`, `dist/renderer`, а Browser — в `dist/web`. `npm run package:dir` создаёт распакованную Desktop-сборку; для установщиков доступны `package:win`, `package:linux` и `package:mac`.
