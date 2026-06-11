
const vscode = require('vscode');
const cp = require('child_process');

let sessionProc = null;
let stdoutBuf = '';
const pending = new Map(); // id -> {resolve, reject}
const NOTEBOOK_MARKER_PREFIX = '__SC_CELL_END__';

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

function startSession() {
  if (sessionProc) return;
  const config = vscode.workspace.getConfiguration('supercollider.sclang');
  const sclangPath = config.get('Path', 'sclang');
  try {
    sessionProc = cp.spawn(sclangPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    sessionProc = null;
    if (e.code === 'ENOENT') {
      throw new Error(
        `Could not find sclang binary at '${sclangPath}'. Add to environment path or use workspace setting supercollider.sclang.Path.`
      );
    }
    throw e;
  }

  sessionProc.stdout.on('data', (d) => handleChunk(d.toString()));
  sessionProc.stderr.on('data', (d) => handleChunk(d.toString()));

  sessionProc.on('error', (err) => {
    if (err.code === 'ENOENT') {
      const message = `Could not find sclang binary at '${sclangPath}'. Add to environment path or use workspace setting supercollider.sclang.Path.`;
      vscode.window.showErrorMessage(message);
      for (const { reject } of pending.values()) reject(new Error(message));
      pending.clear();
      sessionProc = null;
      return;
    }
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
    sessionProc = null;
  });

  sessionProc.on('close', (code) => {
    const err = new Error('sclang exited: ' + code);
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
    sessionProc = null;
  });
}

function handleChunk(chunk) {
  stdoutBuf += chunk;

  // Process any complete markers
  const markerRe = new RegExp(`${NOTEBOOK_MARKER_PREFIX}([0-9a-fA-F_-]+)__`);
  let match;
  while ((match = stdoutBuf.match(markerRe))) {
    const id = match[1];
    const idx = match.index;
    const out = stdoutBuf.slice(0, idx);
    stdoutBuf = stdoutBuf.slice(idx + match[0].length);

    const p = pending.get(id);
    if (p) {
      p.resolve(out);
      pending.delete(id);
    }
  }
}

function sendSclangControl(code) {
  if (!sessionProc) {
    try {
      startSession();
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
      return;
    }
  }

  try {
    const payload = `${code.replace(/\r\n/g, '\n')}\n`;
    console.log('[sclang] sendControl:', payload);
    sessionProc.stdin.write(payload);
  } catch (err) {
    vscode.window.showErrorMessage('Failed to send SuperCollider command: ' + String(err));
  }
}

function findEnclosingDelimiterRange(text, offset, openChar, closeChar) {
  const ranges = [];
  for (let start = offset - 1; start >= 0; start--) {
    if (text[start] !== openChar) continue;

    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === openChar) {
        depth++;
      } else if (text[i] === closeChar) {
        depth--;
        if (depth === 0) {
          if (i >= offset) {
            ranges.push({ start, end: i + 1 });
          }
          break;
        }
      }
    }
  }
  if (ranges.length === 0) {
    return undefined;
  }
  ranges.sort((a, b) => (a.end - a.start) - (b.end - b.start));
  return ranges[0];
}

function getScopeRange(document, position) {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const candidateRanges = [];

  const parenRange = findEnclosingDelimiterRange(text, offset, '(', ')');
  if (parenRange) candidateRanges.push(parenRange);
  const braceRange = findEnclosingDelimiterRange(text, offset, '{', '}');
  if (braceRange) candidateRanges.push(braceRange);
  const bracketRange = findEnclosingDelimiterRange(text, offset, '[', ']');
  if (bracketRange) candidateRanges.push(bracketRange);

  if (candidateRanges.length > 0) {
    candidateRanges.sort((a, b) => (a.end - a.start) - (b.end - b.start));
    const chosen = candidateRanges[0];
    return new vscode.Range(document.positionAt(chosen.start), document.positionAt(chosen.end));
  }

  const line = document.lineAt(position.line);
  return new vscode.Range(line.range.start, line.range.end);
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

async function executeSuperColliderSnippet(code, cell) {
  if (!code || !code.trim()) {
    return 'No SuperCollider code selected.';
  }

  try {
    startSession();
  } catch (err) {
    throw new Error('Failed to start sclang: ' + String(err));
  }

  const id = Date.now().toString(16) + '-' + Math.floor(Math.random() * 0xffff).toString(16);
  const marker = `${NOTEBOOK_MARKER_PREFIX}${id}__`;

  const promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('Execution timed out'));
      }
    }, 30000);

    pending.set(id, {
      resolve: (out) => { clearTimeout(timeout); resolve(out); },
      reject: (err) => { clearTimeout(timeout); reject(err); }
    });
  });

  try {
    const payload = `${code.replace(/\r\n/g, '\n')}\n("${marker}").postln\n`;
    console.log('[sclang] sendExecution:', payload);
    sessionProc.stdin.write(payload);
  } catch (err) {
    pending.delete(id);
    throw new Error('Failed to send code to sclang: ' + String(err));
  }

  return await promise;
}

async function runSelectionOrScope(controller) {
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

  const code = document.getText(range);
  let execution;

  if (cell) {
    execution = controller.createNotebookCellExecution(cell);
    execution.start(Date.now());
    execution.clearOutput();
  }

  try {
    const output = await executeSuperColliderSnippet(code, cell);
    if (execution) {
      const item = vscode.NotebookCellOutputItem.text(output || '');
      execution.replaceOutput([new vscode.NotebookCellOutput([item])]);
      execution.end(true, Date.now());
    } else {
      vscode.window.showInformationMessage(output || 'Executed SuperCollider selection/scope.');
    }
  } catch (err) {
    if (execution) {
      const item = vscode.NotebookCellOutputItem.text('Error: ' + String(err));
      execution.replaceOutput([new vscode.NotebookCellOutput([item])]);
      execution.end(false, Date.now());
    } else {
      vscode.window.showErrorMessage(String(err));
    }
  }
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

  context.subscriptions.push(vscode.commands.registerCommand('supercollider-notebook.freeAll', () => {
    sendSclangControl('s.freeAll');
    vscode.window.showInformationMessage('Sent s.freeAll to SuperCollider.');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('supercollider-notebook.rebootServer', () => {
    sendSclangControl('s.reboot;');
    vscode.window.showInformationMessage('Sent s.reboot to SuperCollider.');
  }));

  const controller = vscode.notebooks.createNotebookController(
    'supercollider-controller',
    'supercollider-notebook',
    'SuperCollider'
  );

  controller.supportedLanguages = ['sclang', 'supercollider'];

  context.subscriptions.push(vscode.commands.registerCommand('supercollider-notebook.runSelectionOrScope', async () => {
    await runSelectionOrScope(controller);
  }));

  controller.executeHandler = async (cells) => {
    for (const cell of cells) {
      const execution = controller.createNotebookCellExecution(cell);
      execution.start(Date.now());
      execution.clearOutput();

      const code = cell.document.getText();

      // Ensure session
      try {
        startSession();
      } catch (err) {
        const item = vscode.NotebookCellOutputItem.text('Failed to start sclang: ' + String(err));
        execution.replaceOutput([new vscode.NotebookCellOutput([item])]);
        execution.end(false, Date.now());
        continue;
      }

      // Create a unique marker for this cell so we know when output is complete
      const id = Date.now().toString(16) + '-' + Math.floor(Math.random() * 0xffff).toString(16);
      const marker = `${NOTEBOOK_MARKER_PREFIX}${id}__`;

      const promise = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        // Timeout in 30s
        const to = setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error('Execution timed out'));
          }
        }, 30000);
        // Wrap resolve/reject to clear timeout
        const origResolve = resolve;
        const origReject = reject;
        pending.set(id, {
          resolve: (out) => { clearTimeout(to); origResolve(out); },
          reject: (err) => { clearTimeout(to); origReject(err); }
        });
      });

      // Send the full cell as one block so SuperCollider receives the complete command at once.
      try {
        const payload = `${code.replace(/\r\n/g, '\n')}\n("${marker}").postln\n`;
        console.log('[sclang] sendCell:', payload);
        sessionProc.stdin.write(payload);
      } catch (e) {
        const item = vscode.NotebookCellOutputItem.text('Failed to send code to sclang: ' + String(e));
        execution.replaceOutput([new vscode.NotebookCellOutput([item])]);
        execution.end(false, Date.now());
        continue;
      }

      // Cancellation should reject the pending promise
      const cancelListener = execution.token.onCancellationRequested(() => {
        const p = pending.get(id);
        if (p && p.reject) p.reject(new Error('Cancelled'));
      });

      try {
        const out = await promise;
        const item = vscode.NotebookCellOutputItem.text(out || '');
        execution.replaceOutput([new vscode.NotebookCellOutput([item])]);
        execution.end(true, Date.now());
      } catch (err) {
        const item = vscode.NotebookCellOutputItem.text('Error: ' + String(err));
        execution.replaceOutput([new vscode.NotebookCellOutput([item])]);
        execution.end(false, Date.now());
      } finally {
        cancelListener.dispose();
      }
    }
  };

  context.subscriptions.push(controller);
}

function deactivate() {
  if (sessionProc) {
    try { sessionProc.kill(); } catch (e) {}
    sessionProc = null;
  }
}

module.exports = { activate, deactivate };
