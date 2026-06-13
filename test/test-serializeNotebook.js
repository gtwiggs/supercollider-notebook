const assert = require("assert");
const mock = require("mock-require");

const suiteName = 'serializeNotebook';

// Setup mock vscode objects for testing outside of actual vscode environment.

class NotebookCellData {
  constructor(kind, value, languageId) {
    this.kind = kind;
    this.value = value;
    this.languageId = languageId;
    this.outputs = [];
    this.metadata = {};
  }
}

class NotebookData {
  constructor(cells = []) {
    this.cells = cells;
    this.metadata = {};
  }
}

const NotebookCellKind = {
  Markup: 1,
  Code: 2,
};

mock("vscode", {
  NotebookCellData,
  NotebookData,
  NotebookCellKind,
});

// End mocks

const {
  SuperColliderNotebookSerializer,
} = require("../src/SuperColliderNotebookSerializer");
const serializer = new SuperColliderNotebookSerializer();

async function roundTrip(cells) {
  const notebook = await serializer.serializeNotebook(cells);
  const result = await serializer.deserializeNotebook(notebook);
  return result;
}

// Test scenarios
const scenarios = [
  {
    name: "first only markup",
    data: {
      cells: [
        { kind: NotebookCellKind.Markup, value: "# Title\nSome text" },
      ],
    },
  },
  {
    name: "first markup then code",
    data: {
      cells: [
        { kind: NotebookCellKind.Markup, value: "# Title\nIntro" },
        { kind: NotebookCellKind.Code, value: "s.boot;" },
      ],
    },
  },
  {
    name: "first code then markup",
    data: {
      cells: [
        { kind: NotebookCellKind.Code, value: "s.boot;" },
        { kind: NotebookCellKind.Markup, value: "# Note\nmd text" },
      ],
    },
  },
  {
    name: "mixed",
    data: {
      cells: [
        { kind: NotebookCellKind.Code, value: "a=1;" },
        { kind: NotebookCellKind.Code, value: "b=2;" },
        { kind: NotebookCellKind.Markup, value: "# header" },
        { kind: NotebookCellKind.Code, value: "a.postln;" },
      ],
    },
  },
];

let allPassed = true;

for (const s of scenarios) {
  roundTrip(s.data)
    .then((back) => {
      // Verify kinds and counts
      try {
        assert.strictEqual(
          back.cells.length,
          s.data.cells.length,
          `scenario ${s.name} produced wrong cell count`,
        );
        for (let i = 0; i < s.data.cells.length; ++i) {
          // const expectKind = s.data.cells[i].kind === 'markup' ? 'markup' : 'code';
          assert.strictEqual(
            back.cells[i].kind,
            s.data.cells[i].kind,
            `scenario ${s.name} cell ${i} kind mismatch`,
          );
          // text should match ignoring trailing newline normalization
          const expText = s.data.cells[i].value
            .replace(/\r\n/g, "\n")
            .replace(/\n$/, "");
          const gotText = back.cells[i].value
            .replace(/\r\n/g, "\n")
            .replace(/\n$/, "");
          assert.strictEqual(
            gotText,
            expText,
            `scenario ${s.name} cell ${i} text mismatch`,
          );
        }
        console.log(`[PASS] ${suiteName}: ${s.name}`);
      } catch (error) {
        allPassed = false;
        console.log(`[FAIL] ${suiteName}: ${s.name} - ${error.message}`);
      }
    })
    .catch((error) => {
      allPassed = false;
      console.log(`FAIL: ${s.name} - threw error ${error}`);
    });
}

if (!allPassed) {
  process.exitCode = 1;
}
