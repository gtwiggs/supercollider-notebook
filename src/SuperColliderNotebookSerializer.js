const vscode = require('vscode');

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
exports.SuperColliderNotebookSerializer = SuperColliderNotebookSerializer;
