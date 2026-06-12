
const vscode = require('vscode');
const sc = require('supercolliderjs');
const { getScopeOffsetRange } = require('./scopeRange');
const { SuperColliderNotebookSerializer } = require('./SuperColliderNotebookSerializer');

let lang = null;
let statusBar = null;
let statusBarPollTimer = null;
let statusBarUpdating = false;
let statusBarPopupMessage = 'SuperCollider server status unknown.';

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

  // Status Bar

	// Register a command that is invoked when the status bar item is selected.

  const statusBarCommandId = 'sclang.serverStatus';
	context.subscriptions.push(vscode.commands.registerCommand(statusBarCommandId, () => {
		vscode.window.showInformationMessage(statusBarPopupMessage);
	}));

  // Create the Status Bar item

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBar.command = statusBarCommandId;
	context.subscriptions.push(statusBar);

  // Register a listener that keeps the status bar up to date.

  statusBarPollTimer = setInterval(() => {
    void updateStatusBarItem();
  }, 1000);

  context.subscriptions.push(new vscode.Disposable(() => {
    if (statusBarPollTimer) {
      clearInterval(statusBarPollTimer);
      statusBarPollTimer = null;
    }
  }));

	// update status bar item once at start
	void updateStatusBarItem();
}

function deactivate() {
  if (statusBarPollTimer) {
    clearInterval(statusBarPollTimer);
    statusBarPollTimer = null;
  }
  if (lang) {
    lang.quit().catch(() => {});
    lang = null;
  }
}

// Update Status Bar

async function executeScRequest(code) {
  try {
    await startSession();
    const safeCode = code.replace(/\r\n/g, '\n');
    return await lang.interpret(safeCode, undefined, true);
  } catch (err) {
    statusBarPopupMessage = 'Unexpected error accessing the SuperCollider server:\n' + String(err);
    /*
      error  : {
          "code": "ERR_STREAM_DESTROYED"
        }
    */
    console.error('Failed to execute SuperCollider request:', err);
    return 0;
  }
}

async function updateStatusBarItem() {
  if (!statusBar || statusBarUpdating) return;
  statusBarUpdating = true;
  try {
    const status = await executeScRequest('if ( s.serverRunning, "yes", "no" )');
    if (status === 'yes') {
      // get s.peakCPU & s.avgCPU and include in the message.
      const peak = 0;
      const avg = 0;
      statusBar.text = `$(gear) Running ${avg}%`;
      statusBar.color = new vscode.ThemeColor('statusBar.foreground');
      statusBar.backgroundColor = undefined; // theme default
      statusBarPopupMessage = `SuperCollider server is running. Peak CPU usage: ${peak}%, average CPU usage: ${avg}%`;
    } else {
      const status = await executeScRequest('if ( s.serverBooting, "yes", "no" )');
      if (status === 'yes') {
        statusBar.text = '$(gear) Booting';
        statusBar.color = new vscode.ThemeColor('statusBarItem.warningForeground');
        statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        statusBarPopupMessage = 'SuperCollider server is booting.';
      } else {
        statusBar.text = '$(gear) Stopped';
        statusBar.color = new vscode.ThemeColor('statusBarItem.errorForeground');
        statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        statusBarPopupMessage = 'SuperCollider server is stopped.';
      }
    }
    statusBar.show();
  } finally {
    statusBarUpdating = false;
  }
}

module.exports = { activate, deactivate };
