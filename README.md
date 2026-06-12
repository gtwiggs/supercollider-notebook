# SuperCollider Notebook

This workspace extension provides a SuperCollider notebook experience.

## What it does

- Registers a `.scnb` notebook type for SuperCollider source.
- Runs notebook cells through a persistent `sclang` process.
- Supports normal cell execution via the notebook run action.
- Supports scope-aware execution for the current cursor position.

## Run selection or current scope

When the active notebook cell has a selection, the extension executes that selected text.

When there is no selection, it looks for an enclosing block around the cursor:

- `(...)` parenthesized form
- `{...}` function/block form
- `[...]` array or collection form

If no block is found, it executes the current line.

This gives a SuperCollider-style workflow in the notebook while preserving normal cell execution behavior.

## Commands and hotkeys

- `SuperCollider: Run selection or current scope`
  - default keybinding: `cmd+enter` on macOS, `ctrl+enter` on Windows/Linux
- `SuperCollider: boot server`
  - default keybinding: `cmd+B` / `ctrl+B`
- `SuperCollider: s.freeAll`
  - default keybinding: `cmd+.` / `ctrl+.`
- `SuperCollider: reboot server`
  - default keybinding: `cmd+shift+.` / `ctrl+shift+.`

## Requirements

- `sclang` must be installed and available to VSCode (see [Configuration](#Configuration) for help).

## How to run locally

1. Open this folder in VS Code.
2. Run the "Run Extension" debug target (F5) to launch an Extension Development Host.
3. Create a new file with extension `.scnb`.
4. Set the file language to `sclang` if needed.
5. Use the notebook cell actions to execute full cells.
6. Use the new command or keybinding to execute a selection or the current scope.

## Configuration

Set the path explicitly if `sclang` is not in your shell PATH:

```json
{
  "supercollider.sclang.Path": "/Applications/SuperCollider.app/Contents/MacOS/sclang"
}
```
