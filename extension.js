
const vscode = require('vscode');
const cp = require('child_process');

let sessionProc = null;
let stdoutBuf = '';
const pending = new Map(); // id -> {resolve, reject}

class SuperColliderNotebookSerializer {
  async deserializeNotebook(content) {
    const raw = Buffer.from(content).toString('utf8');
    const cells = [];
    if (raw.length > 0) {
      cells.push(new vscode.NotebookCellData(
        vscode.NotebookCellKind.Code,
        raw,
        'sclang'
      ));
    }
    return new vscode.NotebookData(cells);
  }

  async serializeNotebook(data) {
    const text = data.cells.map((cell) => cell.value).join('\n\n');
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

  sessionProc.stdout.on('data', (d) => handleChunk(d.toString()));
  sessionProc.stderr.on('data', (d) => handleChunk(d.toString()));

  sessionProc.on('error', (err) => {
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
  const markerRe = /__SC_CELL_END__([0-9a-fA-F_-]+)__/;
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
    sessionProc.stdin.write(code + '\n');
  } catch (err) {
    vscode.window.showErrorMessage('Failed to send SuperCollider command: ' + String(err));
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
      const marker = `__SC_CELL_END__${id}__`;

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

      // Send code followed by a postln of the marker so we can detect completion
      try {
        sessionProc.stdin.write(code + '\n');
        sessionProc.stdin.write(`("${marker}").postln\n`);
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
