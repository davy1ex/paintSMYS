# paintSMYS — Testing

This file records the checks present in the repository and the minimum evidence expected for future changes. It reflects implementation, not every PRD target.

## Existing coverage and gaps

| Area | Existing checks and level | Main gap / next check |
| --- | --- | --- |
| Document Core | Unit/contract: `rectangle-document.test.ts`, `text-object.test.ts`; immutable add/update/remove, validation, UTF-16 ranges, legacy text | Additional pure operations need contracts when introduced; no broad coverage target |
| Geometry | Unit: `rectangle-geometry.test.ts`; drag normalization, SVG transform, hit testing | Real pointer interaction is covered by Browser E2E below |
| Text / Styled Text | Unit/contract: `text-object.test.ts`; render/save checks in `png-export.test.ts` and `code-card-plugin.test.ts` | Real text focus, multiline input, Inspector and Undo are covered by Browser E2E below |
| History | Unit: `document-history.test.ts`; snapshot Undo/Redo, one move entry, clean baseline, async save snapshots | Some save/text/plugin flow tests repeat the cross-layer invariant intentionally |
| Project Storage | Filesystem integration with temporary folders: `project-save.test.ts`; atomic manifest behavior, Save/Open, failure and in-flight save cases | Native dialogs and Electron IPC are not exercised |
| PNG Export | Unit/integration: `png-export.test.ts`; SVG serialization, payload limits and Desktop byte validation | Browser rasterization, downloaded PNG dimensions and pixels are covered by Browser E2E below |
| Property Inspector | No component/browser test existed before this milestone | Browser E2E edits Font Size, checks SVG, Enter/Escape and Undo |
| Plugin API | Unit/contract: `plugin-api.test.ts`; manifest, form schema/value, command and object validation | Real iframe is intentionally out of scope |
| Plugin UI / runtime | Simulated-frame integration: `plugin-runtime.test.ts`; submit, cancel, timeout, stale session and rollback; plugin examples also cover atomic undo/save | Actual sandbox iframe and rendered plugin form are not browser-tested in this milestone |
| Desktop IPC | Unit tests for close policy/handshake in `project-close.test.ts` | Main/Preload IPC and native dialogs need platform integration / Electron E2E later |
| Web Editor | No browser E2E existed before this milestone; `tests/e2e/editor.spec.ts` adds 3 Chromium user flows | Local execution depends on a runnable Chromium; CI uses Linux Chromium |

Existing tests already characterize the requested Core, History, Save/Open and Plugin Host contracts. In particular: `addRectangle`/property immutability; styled UTF-16 ranges; save/open round-trip; one completed move as one history entry; undo to the saved baseline; an async Save preserving newer edits; and atomic plugin batch/cancel/stale-session behavior. This milestone adds no duplicate characterization test. Cross-layer cases in `project-save.test.ts`, `text-object.test.ts`, `plugin-api.test.ts`, and `code-card-plugin.test.ts` overlap at the application contract level; keep the unit contract tests and a small number of representative end-to-end flows rather than expanding the same matrix in every file.

Highest remaining risks: real plugin iframe/UI lifecycle and Electron Main/Preload IPC with native dialogs. Electron E2E and plugin iframe E2E remain out of scope.

## Commands and artifacts

- Unit/filesystem integration: `npm test` (built-in `node:test`, compiled by `tsc -p tsconfig.test.json`).
- Typecheck: `npm run typecheck`.
- Browser E2E, headless Chromium: `npm run test:e2e`.
- Browser E2E, headed local debugging: `npm run test:e2e:headed`.
- Open the HTML report: `npm run test:e2e:report`.
- Playwright retains traces and screenshots on failure under `test-results/`; the HTML report is written to `playwright-report/`. The trace includes action chronology, DOM snapshots and browser console/page errors attached by the spec.
- Open a specific retained trace with `npx playwright show-trace test-results/<test-folder>/trace.zip`.

Tests use a fresh Playwright page/context per test, a fixed 1440×1000 viewport, and an isolated Vite server on `127.0.0.1:4173`. There are no arbitrary sleeps or React-state reads. Run CI on Linux with `npx playwright install --with-deps chromium`; see `.github/workflows/web-e2e.yml`.

## WSL notes

In the audited WSL1 environment, `/usr/bin/node` v22.22.1 works, but PATH `npm`/`npx` resolve to Windows wrappers and report `WSL 1 is not supported`. Invoking the npm CLI JavaScript with Linux Node works. Starting Windows `node.exe`, Chrome or Edge fails with `UtilBindVsockAnyPort: socket failed 1`. The downloaded Linux Chromium does run here: all three Browser E2E passed headless. No WSL setting or system package was changed.

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
