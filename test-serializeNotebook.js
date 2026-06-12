const assert = require('assert');

const CELL_DELIMITER = /^\/\/\s*%%/;
const CELL_DELIMITER_MD = /^\/\/\s*%%\s*md\b/i;

function serialize(cells) {
  let out = '';
  for (let i = 0; i < cells.length; ++i) {
    const cell = cells[i];
    const text = cell.value.replace(/\r\n/g, '\n').replace(/\n$/, '');

    if (i > 0 || cell.kind === 'markup') {
      const marker = cell.kind === 'markup' ? '// %% md' : '// %%';
      out += (out.length > 0 ? '\n' : '') + marker + '\n';
    }

    out += text;
  }
  return out;
}

function deserialize(raw) {
  const lines = raw.split(/\r?\n/);
  const cells = [];
  let current = [];
  let currentKind = 'code';
  let currentLang = 'sclang';

  for (const line of lines) {
    if (CELL_DELIMITER.test(line)) {
      if (current.length > 0 || cells.length > 0) {
        cells.push({ kind: currentKind, lang: currentLang, value: current.join('\n') });
      }
      currentKind = CELL_DELIMITER_MD.test(line) ? 'markup' : 'code';
      currentLang = currentKind === 'markup' ? 'markdown' : 'sclang';
      current = [];
    } else {
      current.push(line);
    }
  }

  if (current.length > 0 || cells.length === 0) {
    cells.push({ kind: currentKind, lang: currentLang, value: current.join('\n') });
  }

  return cells;
}

function roundTrip(cells) {
  const out = serialize(cells);
  return deserialize(out);
}

// Test scenarios
const scenarios = [
  { name: 'first only markup', cells: [{ kind: 'markup', value: '# Title\nSome text' }] },
  { name: 'first markup then code', cells: [{ kind: 'markup', value: '# Title\nIntro' }, { kind: 'code', value: 's.boot;' }] },
  { name: 'first code then markup', cells: [{ kind: 'code', value: 's.boot;' }, { kind: 'markup', value: '# Note\nmd text' }] },
  { name: 'mixed', cells: [{ kind: 'code', value: 'a=1;' }, { kind: 'code', value: 'b=2;' }, { kind: 'markup', value: '# header' }, { kind: 'code', value: 'a.postln;' }] },
];

for (const s of scenarios) {
  const back = roundTrip(s.cells);
  // Verify kinds and counts
  assert.strictEqual(back.length, s.cells.length, `scenario ${s.name} produced wrong cell count`);
  for (let i = 0; i < s.cells.length; ++i) {
    const expectKind = s.cells[i].kind === 'markup' ? 'markup' : 'code';
    assert.strictEqual(back[i].kind, expectKind, `scenario ${s.name} cell ${i} kind mismatch`);
    // text should match ignoring trailing newline normalization
    const expText = s.cells[i].value.replace(/\r\n/g, '\n').replace(/\n$/, '');
    const gotText = back[i].value.replace(/\r\n/g, '\n').replace(/\n$/, '');
    assert.strictEqual(gotText, expText, `scenario ${s.name} cell ${i} text mismatch`);
  }
}

console.log('PASS: serialize/deserialize roundtrip tests');
process.exit(0);
