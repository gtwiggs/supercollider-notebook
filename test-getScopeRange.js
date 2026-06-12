const { getScopeOffsetRange } = require('./scopeRange');

function formatRange(range) {
  return range ? `{ start: ${range.start}, end: ${range.end} }` : 'undefined';
}

function runTestCase(name, code, offset, expected) {
  const actual = getScopeOffsetRange(code, offset);
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}`);
  if (!passed) {
    console.log(`      code: ${JSON.stringify(code)}`);
    console.log(`      offset: ${offset}`);
    console.log(`      expected: ${formatRange(expected)}`);
    console.log(`      actual:   ${formatRange(actual)}`);
  }
  return passed;
}

const cases = [
  {
    name: 'fallback to current line when no enclosing scope or selection',
    code: 'fooBar baz',
    offset: 6,
    expected: { start: 0, end: 10 },
  },
  {
    name: 'select parenthesized expression left of cursor',
    code: 'foo(bar + 1)',
    offset: 12,
    expected: { start: 3, end: 12 },
  },
  {
    name: 'prefer outermost enclosing parentheses over inner scope',
    code: "(\n" +
          "  r = {\n" +
          "    loop{\n" +
          "      s.bind{ Synth(\\i) };\n" +
          "      (1/200).yield;\n" +
          "    }\n" +
          "  }.r.play\n" +
          ");\n" +
          "r.stop();\n",
    offset: 56,
    expected: { start: 0, end: 86 },
  },
  {
    name: 'fallback to current line when no enclosing scope',
    code: '\nSynth(\\i)\n"ignore me".postln\n',
    offset: 4,
    expected: { start: 1, end: 10 },
  },
  {
    name: 'ignore whitespace left of cursor falls back to line',
    code: 'foo bar ',
    offset: 8,
    expected: { start: 0, end: 8 },
  },
];

let allPassed = true;
for (const testCase of cases) {
  const passed = runTestCase(testCase.name, testCase.code, testCase.offset, testCase.expected);
  if (!passed) allPassed = false;
}

if (!allPassed) {
  process.exitCode = 1;
}

console.log('Add or edit test cases in test-getScopeRange.js to cover more cursor scenarios.');
console.log('Run with: node test-getScopeRange.js');
