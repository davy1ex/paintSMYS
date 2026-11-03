# paintSMYS — Testing

This file records the checks present in the repository and the minimum evidence expected for future changes. It reflects implementation, not every PRD target.

## Existing coverage and gaps

| Area | Existing checks and level | Main gap / next check |
| --- | --- | --- |
| Document Core | Unit/contract: `rectangle-document.test.ts`, `text-object.test.ts`; immutable add/update/remove, validation, UTF-16 ranges, legacy text | Additional pure operations need contracts when introduced; no broad coverage target |
| Geometry | Unit: `rectangle-geometry.test.ts`; drag normalization, SVG transform, hit testing | Real pointer interaction is covered by Browser E2E below |
| Text / Styled Text | Unit/contract: `text-object.test.ts`; render/save checks in `png-export.test.ts` and `code-card-plugin.test.ts` | Real text focus, multiline input, Inspector and Undo are covered by Browser E2E below |
| History | Unit: `document-history.test.ts`; snapshot Undo/Redo, one move entry, clean baseline, async save snapshots | Some save/text/plugin flow tests repeat the cross-layer invariant intentionally |
| Project Storage | Filesystem integration with temporary folders: `project-save.test.ts`; atomic manifest behavior, Save/Open, failure and in-flight save cases; Desktop E2E saves and reopens through IPC | Native dialog UI and OS path selection are not exercised |
| PNG Export | Unit/integration: `png-export.test.ts`; SVG serialization, payload limits and Desktop byte validation | Browser rasterization, downloaded PNG dimensions and pixels are covered by Browser E2E below |
| Property Inspector | No component/browser test existed before this milestone | Browser E2E edits Font Size, checks SVG, Enter/Escape and Undo |
| Plugin API | Unit/contract: `plugin-api.test.ts`; manifest, form schema/value, command and object validation | The real iframe and form flow are exercised by the Desktop E2E below |
| Plugin UI / runtime | Simulated-frame integration: `plugin-runtime.test.ts`; submit, cancel, timeout, stale session and rollback; Desktop E2E runs Code Card through the sandbox iframe and rendered form | Other third-party plugins are intentionally not launched |
| Desktop IPC | Unit tests for close policy/handshake in `project-close.test.ts`; Desktop E2E covers Preload and Main project Save/Open IPC | Native dialog UI and platform-specific dialog behavior remain outside automation |
| Web Editor | No browser E2E existed before this milestone; `tests/e2e/editor.spec.ts` adds 3 Chromium user flows | Local execution depends on a runnable Chromium; CI uses Linux Chromium |
| Desktop Electron | `tests/desktop-e2e/desktop.spec.ts` launches the built Main, Renderer and Preload with Playwright Electron; covers startup/drawing, disk Save/Open, real sandboxed Code Card iframe, Shiki colors, cancel, Undo and Redo | Native OS dialog UI is not automated; Linux CI uses Xvfb |

Existing tests already characterize the requested Core, History, Save/Open and Plugin Host contracts. In particular: `addRectangle`/property immutability; styled UTF-16 ranges; save/open round-trip; one completed move as one history entry; undo to the saved baseline; an async Save preserving newer edits; and atomic plugin batch/cancel/stale-session behavior. This milestone adds no duplicate characterization test. Cross-layer cases in `project-save.test.ts`, `text-object.test.ts`, `plugin-api.test.ts`, and `code-card-plugin.test.ts` overlap at the application contract level; keep the unit contract tests and a small number of representative end-to-end flows rather than expanding the same matrix in every file.

The desktop suite uses Playwright Electron and launches `dist/main/main.js`; it does not start the Web Vite server. It is serial with one worker. Each test creates a unique temporary root and passes its `user-data/` folder through `--paint-smys-user-data` before app readiness. Plugin scenarios copy only the repository's real Code Card manifest and built `index.js` into that profile before launch. Electron sandboxing, Renderer context isolation, the Preload bridge, IPC checks, Core validation, the sandboxed `allow-scripts` iframe, CSP, message validation and stale-session guards stay enabled.

Save/Open tests set `--paint-smys-e2e` plus a temporary dialog directory. Main returns that fixed project folder only from the project `showSaveDialog` / `showOpenDialog` boundary. The policy requires an unpackaged app, exactly one E2E marker, unique absolute profile/dialog arguments, and the `paintsmys-desktop-e2e-*/user-data` plus sibling `dialogs/` layout used by the Playwright fixture. Packaged applications always use native dialogs, and no environment variable supplies a dialog path. The UI action, `window.paintSMYS` bridge, IPC handler, storage adapter, atomic disk write/read and Core manifest validation still run. The native dialog window, its platform rendering, navigation, keyboard behavior and OS permissions are outside automation. PNG and message-box dialogs are not intercepted.

`npm run test:e2e:desktop` builds the current Desktop app and Code Card bundle before running the suite. On Linux without `DISPLAY`, the runner uses `xvfb-run -a`; install Xvfb first if it is missing. `npm run test:e2e:desktop:headed` runs in the current desktop session and needs a display on Linux. CI launches the command as `xvfb-run -a npm run test:e2e:desktop`. Electron always creates a real visible `BrowserWindow`; Xvfb supplies a virtual display in CI. The tests verify the loaded page is `file://.../dist/renderer/desktop.html` and that the exposed Preload API is present.

On failure, Playwright retains a Renderer screenshot, a trace when Electron context tracing is supported, renderer errors, Electron Main console errors, stdout/stderr and the child process exit code/signal. These are attached under `test-results/desktop/` and included in `playwright-report/desktop/`; successful runs do not retain screenshots or traces. Temporary profiles and projects are removed after each test. The desktop worker count is one to prevent concurrent Electron processes from sharing state.

Highest remaining risks: native dialog UI and platform-specific filesystem/permission behavior are not exercised by the dialog-boundary fixture. Linux CI covers the real Electron process and storage path; Windows/macOS dialog presentation still needs manual or platform integration coverage.

## Commands and artifacts

- Unit/filesystem integration: `npm test` (built-in `node:test`, compiled by `tsc -p tsconfig.test.json`).
- Typecheck: `npm run typecheck`.
- Browser E2E, headless Chromium: `npm run test:e2e`.
- Browser E2E, headed local debugging: `npm run test:e2e:headed`.
- Electron Desktop E2E: `npm run test:e2e:desktop` (builds Desktop and Code Card first; uses Xvfb on Linux without a display).
- Electron Desktop E2E, current display: `npm run test:e2e:desktop:headed`.
- Open the HTML report: `npm run test:e2e:report`.
- Playwright retains traces and screenshots on failure under `test-results/`; the HTML report is written to `playwright-report/`. The trace includes action chronology, DOM snapshots and browser console/page errors attached by the spec.
- Open a specific retained trace with `npx playwright show-trace test-results/<test-folder>/trace.zip`.
- Desktop E2E diagnostics are attached under `test-results/desktop/`; its HTML report is `playwright-report/desktop/`.

Browser tests use a fresh Playwright page/context per test, a fixed 1440×1000 viewport, and an isolated Vite server on `127.0.0.1:4173`. Desktop tests use a new Electron process and userData directory per test and do not use that web server. There are no arbitrary sleeps or React-state reads. CI runs Browser E2E on Chromium and a separate Linux Electron job under Xvfb; see `.github/workflows/web-e2e.yml`.

## WSL notes

In the audited WSL1 environment, `/usr/bin/node` v22.22.1 works, but PATH `npm`/`npx` resolve to Windows wrappers and report `WSL 1 is not supported`. Invoking the npm CLI JavaScript with Linux Node works. Starting Windows `node.exe`, Chrome or Edge fails with `UtilBindVsockAnyPort: socket failed 1`. The downloaded Linux Chromium does run here: all three Browser E2E passed headless. Electron E2E additionally needs Linux Electron dependencies and an X server; the Desktop command uses Xvfb when available and `DISPLAY` is unset. No WSL setting or system package was changed for the previous Browser milestone.

## Rules for AI coding agents

- **Core change:** add or update unit/contract tests against public inputs and independent expected values.
- **UI change:** add or update Browser E2E for observable user behavior; interact through mouse and keyboard.
- **Electron Main or Preload change:** add platform integration checks, then Electron E2E when that infrastructure exists.
- **Plugin API change:** cover compatibility, validation, rollback and lifecycle behavior.
- **Bug fix:** first add a test that reproduces the reported bug, then fix it.
- **New feature:** define observable acceptance criteria before implementation.
- **Do not duplicate** an existing contract test just to increase test count; do not use a 100% coverage target.

Every completion report lists these separately, with `passed`, `failed`, or `not run`, and names unverified scenarios:

- Unit tests
- Integration tests
- Browser E2E
- Electron E2E
- Unverified scenarios / environment limits

Typecheck and builds alone do not prove that a user-facing feature works.
