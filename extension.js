
const vscode = require('vscode');
const sc = require('supercolliderjs');
const { getScopeOffsetRange } = require('./scopeRange');

let lang = null;

const CELL_DELIMITER = /^\/\/\s*%%/;

class SuperColliderNotebookSerializer {
  async deserializeNotebook(content) {
    const raw = Buffer.from(content).toString('utf8');
    const lines = raw.split(/\r?\n/);
    const cells = [];
    let current = [];

    for (const line of lines) {
      if (CELL_DELIMITER.test(line)) {
        cells.push(new vscode.NotebookCellData(
          vscode.NotebookCellKind.Code,
          current.join('\n'),
          'sclang'
        ));
        current = [];
      } else {
        current.push(line);
      }
    }

    cells.push(new vscode.NotebookCellData(
      vscode.NotebookCellKind.Code,
      current.join('\n'),
      'sclang'
    ));

    if (cells.length === 1 && cells[0].value === '') {
      return new vscode.NotebookData([]);
    }

    return new vscode.NotebookData(cells);
  }

  async serializeNotebook(data) {
    const text = data.cells
      .map((cell) => cell.value.replace(/\r\n/g, '\n').replace(/\n$/, ''))
      .join('\n// %%\n');
    return Buffer.from(text, 'utf8');
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

  controller.supportedLanguages = ['sclang', 'supercollider'];

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
