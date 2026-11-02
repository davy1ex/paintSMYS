# paintSMYS Plugin API v0

Plugin API v0 supports local Desktop action plugins. A plugin contributes one or more named menu commands and can read a document snapshot, stage standard scene objects, and report a user-facing error. It cannot define tools, Inspector fields, or custom UI.

## Install a local plugin

1. Close paintSMYS.
2. Copy a plugin package folder, such as `examples/plugins/win95-window`, into the `plugins` directory under Electron's user data directory:

   ```text
   <app.getPath('userData')>/plugins/win95-window/
   ```

   The current packaged app normally uses `%APPDATA%/paintSMYS/plugins` on Windows, `~/.config/paintSMYS/plugins` on Linux, and `~/Library/Application Support/paintSMYS/plugins` on macOS. Electron derives this location from the application name; use `app.getPath('userData')` if a package or development build uses a different name.

3. Start paintSMYS and open a project. The **Plugins** menu lists commands whose manifest and entry point loaded successfully.

The package is an ordinary local folder containing `manifest.json` and `index.js`. There is no online installation, auto-install, dependency resolution, or hot reload. Restart the application after adding, changing, or removing a plugin. To remove one, close paintSMYS and delete its folder; objects already created remain ordinary document objects.

## Package format

```text
win95-window/
├── manifest.json
└── index.js
```

Minimal manifest:

```json
{
  "id": "com.example.win95-window",
  "name": "Win95 Window",
  "version": "1.0.0",
  "apiVersion": 0,
  "entry": "index.js",
  "commands": [
    { "id": "generate-win95-window", "name": "Generate Win95 Window" }
  ]
}
```

IDs are unique within the installed catalog. Versions use `major.minor.patch` with an optional prerelease suffix. Entry paths are relative `.js` paths inside the package. The host rejects unknown manifest fields, incompatible API versions, malformed or duplicate command IDs, and entry paths that resolve outside the package.

## Plugin contract

The entry point is a plain script, not an ES module. It defines `globalThis.paintSMYSPlugin.activate(api)` and registers every command from the manifest exactly once:

```js
globalThis.paintSMYSPlugin = {
  activate(api) {
    api.registerCommand('generate-win95-window', async (host) => {
      const document = await host.snapshotDocument()
      await host.addObjects([
        {
          type: 'rectangle', x: 20, y: 20, width: 180, height: 120,
          fill: '#c0c0c0', stroke: '#000000', strokeWidth: 2,
        },
        {
          type: 'text', x: 32, y: 48, text: 'Hello',
          fontFamily: 'Arial', fontSize: 16, color: '#000080',
        },
      ])
    })
  },
}
```

`document` is a structured-cloned snapshot, so mutating it cannot mutate the editor. The host API available to a running command is:

- `snapshotDocument(): Promise<SceneDocument>` — returns a read-only-by-copy snapshot of the staged document.
- `addObjects(objects): Promise<void>` — accepts an array of standard Rectangle and Text object data, without IDs. Core assigns fresh IDs and validates the full result. A command may stage up to 500 objects total.
- `showError(message): Promise<void>` — displays a short message in the editor status area.

All `addObjects` calls from one command are staged in memory. If the command succeeds, the host validates and publishes the final document once, making one History entry. If a batch fails or the command throws, staged changes are discarded. A project switch or document edit while the command is running also cancels its commit, so an old result cannot overwrite a new session or a newer document.

## Runtime and trust boundary

Electron Main reads and validates package files under `<app.getPath('userData')>/plugins`; it does not import or execute plugin code. The source is sent to a sandboxed iframe with an opaque origin. The iframe has no `allow-same-origin`, Node integration, Electron bridge, filesystem API, or access to React objects. Its CSP blocks network connections, forms, external images, and other external resources, while Electron blocks non-local iframe navigations. The only host capability is a validated `postMessage` request/response bridge for the API above. Web builds do not load plugins.

This is a minimal runtime for explicitly installed, locally trusted development plugins, not a security boundary for hostile JavaScript. A plugin can consume CPU or memory and may exploit browser or Electron vulnerabilities; CSP and iframe sandbox behavior also depend on the installed runtime. Only install code you trust. paintSMYS does not download or install plugins automatically.

The API version is deliberately small. It does not promise compatibility beyond the declared version and does not expose save, file, network, asset, tool, Inspector, or UI capabilities.

## Example

The external example package in [`examples/plugins/win95-window`](../examples/plugins/win95-window) implements **Generate Win95 Window** using the same loader and iframe runtime as any user-installed package.
