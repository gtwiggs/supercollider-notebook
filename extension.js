
const vscode = require('vscode');
const sc = require('supercolliderjs');
const { getScopeOffsetRange } = require('./scopeRange');

let lang = null;

const CELL_DELIMITER = /^\/\/\s*%%/;
const CELL_DELIMITER_MD = /^\/\/\s*%%\s*md\b/i;

class SuperColliderNotebookSerializer {
  async deserializeNotebook(content) {
    const raw = Buffer.from(content).toString('utf8');
    const lines = raw.split(/\r?\n/);
    const cells = [];
    let current = [];
    // currentKind/language represent the kind for the current accumulating cell.
    let currentKind = vscode.NotebookCellKind.Code;
    let currentLang = 'sclang';

    for (const line of lines) {
      if (CELL_DELIMITER.test(line)) {
        // Marker indicates the start of the next cell. If we have accumulated
        // content, emit it as the previous cell with the previously set kind.
        if (current.length > 0 || cells.length > 0) {
          cells.push(new vscode.NotebookCellData(
            currentKind,
            current.join('\n'),
            currentLang
          ));
        }

        // Now set the kind for the upcoming cell described by this marker.
        currentKind = CELL_DELIMITER_MD.test(line) ? vscode.NotebookCellKind.Markup : vscode.NotebookCellKind.Code;
        currentLang = currentKind === vscode.NotebookCellKind.Markup ? 'markdown' : 'sclang';
        current = [];
      } else {
        current.push(line);
      }
    }

    if (current.length > 0 || cells.length === 0) {
      // Emit trailing cell; default kind is whatever currentKind was last set to
      cells.push(new vscode.NotebookCellData(
        currentKind,
        current.join('\n'),
        currentLang
      ));
    }

    if (cells.length === 1 && cells[0].value === '') {
      return new vscode.NotebookData([]);
    }

    return new vscode.NotebookData(cells);
  }

  async serializeNotebook(data) {
    // Serialize cells into a single text file, inserting markers that
    // indicate the start of the following cell. If the following cell is
    // markdown, include 'md' in the marker so deserialization restores kind.
    let out = '';
    for (let i = 0; i < data.cells.length; ++i) {
      const cell = data.cells[i];
      const text = cell.value.replace(/\r\n/g, '\n').replace(/\n$/, '');

      // Prefix a marker that indicates the kind of this cell. This matches
      // the deserializer which treats markers as starting the following cell.
      if (i > 0 || cell.kind === vscode.NotebookCellKind.Markup) {
        const marker = cell.kind === vscode.NotebookCellKind.Markup ? '// %% md' : '// %%';
        out += (out.length > 0 ? '\n' : '') + marker + '\n';
      }

      out += text;
    }
    return Buffer.from(out, 'utf8');
  }
}

async function startSession() {
  if (lang) return;
  const config = vscode.workspace.getConfiguration('supercollider.sclang');
  const sclangPath = config.get('Path', 'sclang');
  try {
    lang = await sc.lang.boot({
      sclang: sclangPath,
    });
  } catch (err) {
    lang = null;
    if (err.code === 'ENOENT' || err.message.includes('Executable not found')) {
      throw new Error(
        `Could not find sclang binary at '${sclangPath}'. Add to environment path or use workspace setting supercollider.sclang.Path.`
      );
    }
    throw err;
  }
}

async function sendSclangControl(code) {
  try {
    await startSession();
    await lang.interpret(code.replace(/\r\n/g, '\n'), undefined, true);
  } catch (err) {
    vscode.window.showErrorMessage('Failed to send SuperCollider command: ' + String(err));
  }
}

function getScopeRange(document, position) {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const range = getScopeOffsetRange(text, offset);
  return range
    ? new vscode.Range(document.positionAt(range.start), document.positionAt(range.end))
    : undefined;
}

function getNotebookCellForDocument(document) {
  for (const notebook of vscode.workspace.notebookDocuments) {
    for (const cell of notebook.getCells()) {
      if (cell.document.uri.toString() === document.uri.toString()) {
        return cell;
      }
    }
  }
  return undefined;
}

/**
 * Activate the extension: create a Notebook controller for SuperCollider.
 */
function activate(context) {
  const serializer = new SuperColliderNotebookSerializer();
  context.subscriptions.push(vscode.workspace.registerNotebookSerializer(
    'supercollider-notebook',
    serializer,
    { transientOutputs: false }
  ));

  context.subscriptions.push(vscode.commands.registerCommand('supercollider-notebook.freeAll', async () => {
    await sendSclangControl('s.freeAll;');
    vscode.window.showInformationMessage('Sent s.freeAll to SuperCollider.');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('supercollider-notebook.bootServer', async () => {
    await sendSclangControl('s.boot;');
    vscode.window.showInformationMessage('Sent s.boot to SuperCollider.');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('supercollider-notebook.rebootServer', async () => {
    await sendSclangControl('s.reboot;');
    vscode.window.showInformationMessage('Sent s.reboot to SuperCollider.');
  }));

  const controller = vscode.notebooks.createNotebookController(
    'supercollider-controller',
    'supercollider-notebook',
    'SuperCollider'
  );

  controller.supportedLanguages = ['sclang', 'supercollider', 'markdown'];

  async function executeSnippet() {
    const activeEditor = vscode.window.activeTextEditor
      || vscode.window.visibleTextEditors.find((editor) => editor.document.uri.scheme === 'vscode-notebook-cell');
    const notebookEditor = vscode.window.activeNotebookEditor;

    let document;
    let range;
    let cell;

    if (activeEditor) {
      document = activeEditor.document;
      const selection = activeEditor.selection;
      range = selection && !selection.isEmpty ? selection : getScopeRange(document, selection.active);
      cell = getNotebookCellForDocument(document);
    } else if (notebookEditor && notebookEditor.selectedCells && notebookEditor.selectedCells.length > 0) {
      cell = notebookEditor.selectedCells[0];
      document = cell.document;
      range = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    } else {
      vscode.window.showErrorMessage('No active SuperCollider notebook cell or editor found.');
      return;
    }

    if (!range) {
      vscode.window.showErrorMessage('No code scope immediately left of cursor.');
      return;
    }

    const code = document.getText(range);
    await codeExecutionHandler(cell, code);
  }

  async function codeExecutionHandler(cell, snippet) {
    const execution = controller.createNotebookCellExecution(cell);
    execution.start(Date.now());
    execution.clearOutput();

    // If this is a markdown cell, there's nothing to run — mark success.
    if (cell.kind === vscode.NotebookCellKind.Markup) {
      execution.end(true, Date.now());
      return;
    }

    const code = snippet && snippet.length > 0 ? snippet : cell.document.getText();

    try {
      await startSession();
    } catch (err) {
      const item = vscode.NotebookCellOutputItem.text('Failed to start sclang: ' + String(err));
      execution.replaceOutput([new vscode.NotebookCellOutput([item])]);
      execution.end(false, Date.now());
      return;
    }

    let result;
    try {
      const safeCode = code.replace(/\r\n/g, '\n');
      result = await lang.interpret(safeCode, undefined, true);
    } catch (err) {
      const item = vscode.NotebookCellOutputItem.text('Error: ' + String(err));
      execution.replaceOutput([new vscode.NotebookCellOutput([item])]);
      execution.end(false, Date.now());
      return;
    }

    const cancelListener = execution.token.onCancellationRequested(() => {
      // Cancellation on lang.interpret is not currently abortable, but we still
      // mark the cell as cancelled if requested.
      execution.end(false, Date.now());
    });

    try {
      const item = vscode.NotebookCellOutputItem.text(result || '');
      execution.replaceOutput([new vscode.NotebookCellOutput([item])]);
      execution.end(true, Date.now());
    } finally {
      cancelListener.dispose();
    }
  }

  context.subscriptions.push(vscode.commands.registerCommand('supercollider-notebook.executeSnippet', async () => {
    await executeSnippet();
  }));

  controller.executeHandler = async (cells) => {
    for (const cell of cells) {
      await codeExecutionHandler(cell, null);
    }
  };

  context.subscriptions.push(controller);
}

function deactivate() {
  if (lang) {
    lang.quit().catch(() => {});
    lang = null;
  }
}

module.exports = { activate, deactivate };
