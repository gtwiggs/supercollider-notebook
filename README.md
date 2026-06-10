# SuperCollider Notebook (prototype)

This workspace contains a minimal VS Code extension prototype that provides a notebook-like controller for SuperCollider code using `sclang`.

Files added:

- [package.json](package.json#L1) — extension manifest
- [extension.js](extension.js#L1) — activation + notebook controller

Requirements:

- `sclang` (SuperCollider language) must be installed and available on your PATH.

How to run locally:

1. Open this folder in VS Code.
2. Run the "Run Extension" debug target (F5) to launch an Extension Development Host.
3. Create a new file with the extension `.scnb` and set its language to `sclang`.
4. Use the notebook cell actions (run) to execute cells; outputs will come from the `sclang` process.

If you see `Error: spawn sclang ENOENT`, it means `sclang` is not on your PATH. To fix:

- Install SuperCollider and ensure `sclang` is available from your shell.
- Or set the `supercollider.sclang.Path` workspace setting to the full path of the `sclang` binary.

Notes:

- This is a starting prototype. Next steps: add sample notebook, nicer output parsing, persistent sclang session, syntax highlighting, and packaging.

Debug telemetry warning:

- The console message is coming from VS Code's Application Insights telemetry pipeline, not from your extension logic.
- It means telemetry failed to reach the ingestion endpoint and that batch was dropped.
- To avoid this noise, run the extension with the provided launch configuration and/or disable telemetry in VS Code settings.
