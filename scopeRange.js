function findEnclosingDelimiterRanges(text, offset, openChar, closeChar) {
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

  return ranges;
}

function getLineRange(text, offset) {
  const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const nextNewline = text.indexOf('\n', offset);
  const lineEnd = nextNewline === -1 ? text.length : nextNewline;
  return { start: lineStart, end: lineEnd };
}

function findMatchingClose(text, start, openChar, closeChar) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === openChar) {
      depth++;
    } else if (text[i] === closeChar) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return undefined;
}

function findFunctionCallRange(text, offset) {
  const lineRange = getLineRange(text, offset);
  const line = text.slice(lineRange.start, lineRange.end);
  let relOffset = Math.max(0, Math.min(offset - lineRange.start, line.length - 1));

  for (let i = relOffset; i >= 0; i--) {
    if (line[i] !== '(') continue;
    const close = findMatchingClose(line, i, '(', ')');
    if (close === undefined) continue;

    let start = i;
    while (start > 0 && /[\w\d_.$\s]/.test(line[start - 1])) {
      start -= 1;
    }

    const prefix = line.slice(start, i).trim();
    if (!prefix.includes('.')) {
      continue;
    }

    const absoluteClose = lineRange.start + close;
    const nextChar = line[close + 1];
    const shouldStopAtCursor = offset <= absoluteClose && nextChar !== ';';
    return {
      start: lineRange.start + start,
      end: shouldStopAtCursor ? offset : absoluteClose + 1,
    };
  }

  return undefined;
}

function getScopeOffsetRange(text, offset) {
  if (offset === 0) {
    return getLineRange(text, 0);
  }

  const functionCallRange = findFunctionCallRange(text, offset);
  if (functionCallRange) {
    return functionCallRange;
  }

  const searchOffset = offset - 1;

  const parenRanges = findEnclosingDelimiterRanges(text, searchOffset, '(', ')');
  if (parenRanges.length > 0) {
    return parenRanges.reduce((outermost, range) => (
      range.start < outermost.start ? range : outermost
    ), parenRanges[0]);
  }

  const braceRanges = findEnclosingDelimiterRanges(text, searchOffset, '{', '}');
  const bracketRanges = findEnclosingDelimiterRanges(text, searchOffset, '[', ']');

  const candidateRanges = [];
  if (braceRanges.length > 0) candidateRanges.push(braceRanges.sort((a, b) => (a.end - a.start) - (b.end - b.start))[0]);
  if (bracketRanges.length > 0) candidateRanges.push(bracketRanges.sort((a, b) => (a.end - a.start) - (b.end - b.start))[0]);

  if (candidateRanges.length > 0) {
    candidateRanges.sort((a, b) => (a.end - a.start) - (b.end - b.start));
    return candidateRanges[0];
  }

  return getLineRange(text, offset);
}

module.exports = {
  getScopeOffsetRange,
  findEnclosingDelimiterRanges,
};
