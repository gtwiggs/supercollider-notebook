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

function getLineRange(text, offset) {
  const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const nextNewline = text.indexOf('\n', offset);
  const lineEnd = nextNewline === -1 ? text.length : nextNewline;
  return { start: lineStart, end: lineEnd };
}

function getScopeOffsetRange(text, offset) {
  if (offset === 0) {
    return getLineRange(text, 0);
  }

  const candidateRanges = [];
  const searchOffset = offset - 1;

  const parenRange = findEnclosingDelimiterRange(text, searchOffset, '(', ')');
  if (parenRange) candidateRanges.push(parenRange);
  const braceRange = findEnclosingDelimiterRange(text, searchOffset, '{', '}');
  if (braceRange) candidateRanges.push(braceRange);
  const bracketRange = findEnclosingDelimiterRange(text, searchOffset, '[', ']');
  if (bracketRange) candidateRanges.push(bracketRange);

  if (candidateRanges.length > 0) {
    candidateRanges.sort((a, b) => (a.end - a.start) - (b.end - b.start));
    return candidateRanges[0];
  }

  return getLineRange(text, offset);
}

module.exports = {
  getScopeOffsetRange,
  findEnclosingDelimiterRange,
};
