'use strict';

/**
 * Minimal unified-diff formatter with ANSI colorization.
 * Produces output similar to `git diff --no-index`.
 * No external dependencies — just string manipulation.
 */

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/**
 * Generates a colorized unified diff between two strings.
 *
 * @param {string} original - The original file content
 * @param {string} proposed - The proposed new content
 * @param {string} [filePath] - File path to show in the header
 * @param {number} [context=3] - Number of context lines around changes
 * @returns {string} Colorized unified diff, or empty string if unchanged
 */
function unifiedDiff(original, proposed, filePath = 'file', context = 3) {
  const oldLines = original.split('\n');
  const newLines = proposed.split('\n');

  // Simple LCS-based diff (Myers-like, but simplified for typical file sizes)
  const changes = computeLineChanges(oldLines, newLines);

  if (changes.length === 0) return '';

  const hunks = groupIntoHunks(changes, oldLines.length, newLines.length, context);
  const lines = [];

  lines.push(`${DIM}--- a/${filePath}${RESET}`);
  lines.push(`${DIM}+++ b/${filePath}${RESET}`);

  for (const hunk of hunks) {
    lines.push(`${CYAN}@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@${RESET}`);
    for (const line of hunk.lines) {
      if (line.type === 'context') {
        lines.push(` ${line.text}`);
      } else if (line.type === 'remove') {
        lines.push(`${RED}-${line.text}${RESET}`);
      } else if (line.type === 'add') {
        lines.push(`${GREEN}+${line.text}${RESET}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Computes line-level changes between old and new line arrays.
 * Returns an array of { type: 'equal'|'remove'|'add', oldIdx, newIdx, text }.
 */
function computeLineChanges(oldLines, newLines) {
  // Build a simple edit script using the LCS approach
  const lcs = longestCommonSubsequence(oldLines, newLines);
  const changes = [];

  let oi = 0;
  let ni = 0;

  for (const { oldIdx, newIdx } of lcs) {
    // Lines removed before this match
    while (oi < oldIdx) {
      changes.push({ type: 'remove', oldIdx: oi, text: oldLines[oi] });
      oi++;
    }
    // Lines added before this match
    while (ni < newIdx) {
      changes.push({ type: 'add', newIdx: ni, text: newLines[ni] });
      ni++;
    }
    // Matching line
    changes.push({ type: 'equal', oldIdx: oi, newIdx: ni, text: oldLines[oi] });
    oi++;
    ni++;
  }

  // Trailing removals/additions
  while (oi < oldLines.length) {
    changes.push({ type: 'remove', oldIdx: oi, text: oldLines[oi] });
    oi++;
  }
  while (ni < newLines.length) {
    changes.push({ type: 'add', newIdx: ni, text: newLines[ni] });
    ni++;
  }

  // Return only if there are actual differences
  const hasDiff = changes.some((c) => c.type !== 'equal');
  return hasDiff ? changes : [];
}

/**
 * Simple LCS for string arrays using a Map-based approach.
 * Returns array of { oldIdx, newIdx } pairs for matching lines.
 */
function longestCommonSubsequence(a, b) {
  const m = a.length;
  const n = b.length;

  // For very large files, use a patience-diff-like shortcut:
  // match unique lines first, then fill in. But for typical source files
  // (<1000 lines), standard DP is fine.
  if (m > 2000 || n > 2000) {
    return greedyLCS(a, b);
  }

  // Standard DP (O(mn) space — acceptable for typical source files)
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  const result = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.push({ oldIdx: i - 1, newIdx: j - 1 });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result.reverse();
}

/**
 * Greedy LCS for large files — matches unique lines in order.
 */
function greedyLCS(a, b) {
  const bIndex = new Map();
  for (let j = 0; j < b.length; j++) {
    if (!bIndex.has(b[j])) bIndex.set(b[j], []);
    bIndex.get(b[j]).push(j);
  }

  const result = [];
  let lastJ = -1;
  for (let i = 0; i < a.length; i++) {
    const positions = bIndex.get(a[i]);
    if (!positions) continue;
    // Find the first position in b after lastJ
    for (const j of positions) {
      if (j > lastJ) {
        result.push({ oldIdx: i, newIdx: j });
        lastJ = j;
        break;
      }
    }
  }
  return result;
}

/**
 * Groups a flat change list into hunks with context lines.
 */
function groupIntoHunks(changes, oldLen, newLen, context) {
  // Find ranges of non-equal lines
  const diffRanges = [];
  let i = 0;
  while (i < changes.length) {
    if (changes[i].type !== 'equal') {
      const start = i;
      while (i < changes.length && changes[i].type !== 'equal') i++;
      diffRanges.push({ start, end: i });
    } else {
      i++;
    }
  }

  if (diffRanges.length === 0) return [];

  // Merge nearby ranges into hunks (if gap <= 2*context, merge)
  const merged = [diffRanges[0]];
  for (let r = 1; r < diffRanges.length; r++) {
    const prev = merged[merged.length - 1];
    if (diffRanges[r].start - prev.end <= 2 * context) {
      prev.end = diffRanges[r].end;
    } else {
      merged.push({ ...diffRanges[r] });
    }
  }

  // Build hunk objects
  const hunks = [];
  for (const range of merged) {
    const hunkStart = Math.max(0, range.start - context);
    const hunkEnd = Math.min(changes.length, range.end + context);

    const hunkLines = [];
    let oldStart = 1;
    let newStart = 1;
    let oldCount = 0;
    let newCount = 0;

    // Calculate starting line numbers
    let oldLine = 0;
    let newLine = 0;
    for (let c = 0; c < hunkStart; c++) {
      if (changes[c].type === 'equal' || changes[c].type === 'remove') oldLine++;
      if (changes[c].type === 'equal' || changes[c].type === 'add') newLine++;
    }
    oldStart = oldLine + 1;
    newStart = newLine + 1;

    for (let c = hunkStart; c < hunkEnd; c++) {
      const change = changes[c];
      if (change.type === 'equal') {
        hunkLines.push({ type: 'context', text: change.text });
        oldCount++;
        newCount++;
      } else if (change.type === 'remove') {
        hunkLines.push({ type: 'remove', text: change.text });
        oldCount++;
      } else if (change.type === 'add') {
        hunkLines.push({ type: 'add', text: change.text });
        newCount++;
      }
    }

    hunks.push({ oldStart, oldCount, newStart, newCount, lines: hunkLines });
  }

  return hunks;
}

/**
 * Formats multiple file diffs into a single output string.
 *
 * @param {Array<{ displayPath: string, original: string, proposed: string }>} proposals
 * @returns {string} Combined colorized diff output
 */
function formatProposalDiff(proposals) {
  const parts = [];
  for (const { displayPath, original, proposed } of proposals) {
    const diff = unifiedDiff(original, proposed, displayPath);
    if (diff) {
      parts.push(diff);
    }
  }
  return parts.join('\n\n') || `${DIM}(no changes)${RESET}`;
}

module.exports = { unifiedDiff, formatProposalDiff };
