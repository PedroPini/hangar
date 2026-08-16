import { cyan, dim, green, yellow } from "./ansi.mjs";

const colorSequence = /\u001b\[[0-9;]*m/g;
const colorSplit = /(\u001b\[[0-9;]*m)/;
const nonAscii = /[^ -~]/;
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

// Terminals lay text out in columns, not UTF-16 code units: East Asian and emoji
// characters occupy two columns, combining marks and joiners occupy none.
function isWide(codePoint) {
  return (codePoint >= 0x1100 && codePoint <= 0x115f)
    || (codePoint >= 0x2e80 && codePoint <= 0x303e)
    || (codePoint >= 0x3041 && codePoint <= 0x33ff)
    || (codePoint >= 0x3400 && codePoint <= 0x4dbf)
    || (codePoint >= 0x4e00 && codePoint <= 0x9fff)
    || (codePoint >= 0xa000 && codePoint <= 0xa4cf)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1f300 && codePoint <= 0x1f64f)
    || (codePoint >= 0x1f680 && codePoint <= 0x1f6ff)
    || (codePoint >= 0x1f900 && codePoint <= 0x1f9ff)
    || (codePoint >= 0x1fa70 && codePoint <= 0x1faff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd);
}

function isZeroWidth(codePoint) {
  return (codePoint >= 0x0300 && codePoint <= 0x036f)
    || (codePoint >= 0x1ab0 && codePoint <= 0x1aff)
    || (codePoint >= 0x200b && codePoint <= 0x200f)
    || (codePoint >= 0x20d0 && codePoint <= 0x20ff)
    || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
    || codePoint === 0xfeff;
}

function clusters(value) {
  return [...segmenter.segment(value)].map(entry => entry.segment);
}

function clusterWidth(cluster) {
  let width = 0;
  for (const character of cluster) {
    const codePoint = character.codePointAt(0);
    if (isZeroWidth(codePoint)) continue;
    width = Math.max(width, isWide(codePoint) ? 2 : 1);
  }
  return width;
}

// Longest prefix of value that fits in width columns. Always yields at least one
// cluster when width allows any, so callers that slice in a loop keep making progress.
function takeWidth(value, width) {
  let result = "";
  let used = 0;
  for (const cluster of clusters(value)) {
    const size = clusterWidth(cluster);
    if ((result || width <= 0) && used + size > width) break;
    result += cluster;
    used += size;
  }
  return result;
}

export function visibleLength(value) {
  const plain = value.replace(colorSequence, "");
  if (!nonAscii.test(plain)) return plain.length;
  let width = 0;
  for (const cluster of clusters(plain)) width += clusterWidth(cluster);
  return width;
}

export function truncate(value, width) {
  if (width <= 0) return "";
  if (visibleLength(value) <= width) return value;
  if (width === 1) return "…";
  return `${takeWidth(value, width - 1)}…`;
}

export function truncateFromStart(value, width) {
  if (width <= 0) return "";
  if (visibleLength(value) <= width) return value;
  if (width === 1) return "…";
  const list = clusters(value);
  let result = "";
  let used = 0;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const size = clusterWidth(list[index]);
    if (used + size > width - 1) break;
    result = list[index] + result;
    used += size;
  }
  return `…${result}`;
}

function splitToWidth(value, width) {
  const chunks = [];
  let remaining = value;
  while (remaining) {
    const chunk = takeWidth(remaining, width);
    chunks.push(chunk);
    remaining = remaining.slice(chunk.length);
  }
  return chunks;
}

export function wrapText(value, width) {
  if (!value || width <= 0) return [];
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  let lineWidth = 0;

  for (const word of words) {
    const wordWidth = visibleLength(word);
    if (wordWidth > width) {
      if (line) lines.push(line);
      lines.push(...splitToWidth(word, width));
      line = "";
      lineWidth = 0;
    } else if (!line) {
      line = word;
      lineWidth = wordWidth;
    } else if (lineWidth + wordWidth + 1 <= width) {
      line += ` ${word}`;
      lineWidth += wordWidth + 1;
    } else {
      lines.push(line);
      line = word;
      lineWidth = wordWidth;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function wrapPath(value, width) {
  if (!value || width <= 0) return [];
  const lines = [];
  let remaining = value;
  while (visibleLength(remaining) > width) {
    const head = takeWidth(remaining, width + 1);
    const slash = head.lastIndexOf("/");
    // Break at a slash only once it sits far enough in to leave a useful first line.
    const slashColumn = slash < 0 ? -1 : visibleLength(head.slice(0, slash));
    const split = slashColumn < Math.max(1, Math.floor(width * 0.4))
      ? takeWidth(remaining, width).length
      : slash;
    lines.push(remaining.slice(0, split));
    remaining = remaining.slice(split);
  }
  if (remaining) lines.push(remaining);
  return lines;
}

export function labeledPathLines(value, width, label = "From ") {
  const pathLines = wrapPath(value, Math.max(1, width - label.length));
  return pathLines.map((line, index) => `${index ? " ".repeat(label.length) : dim(label)}${line}`);
}

export function clippedWrap(value, width, limit) {
  if (limit <= 0) return [];
  const wrapped = wrapText(value, width);
  const lines = wrapped.slice(0, limit);
  if (wrapped.length > limit && lines.length) {
    const last = lines.length - 1;
    lines[last] = visibleLength(lines[last]) < width
      ? `${lines[last]}…`
      : `${takeWidth(lines[last], Math.max(0, width - 1))}…`;
  }
  return lines;
}

export function pad(value, width) {
  return `${value}${" ".repeat(Math.max(0, width - visibleLength(value)))}`;
}

// Drop visible characters past width while keeping every colour sequence, so a clipped
// line can never leak styling or push the frame past the terminal edge.
export function clampToWidth(value, width) {
  if (width <= 0) return "";
  if (visibleLength(value) <= width) return value;
  let result = "";
  let used = 0;
  let full = false;
  for (const part of value.split(colorSplit)) {
    if (!part) continue;
    if (colorSplit.test(part)) {
      result += part;
      continue;
    }
    if (full) continue;
    for (const cluster of clusters(part)) {
      const size = clusterWidth(cluster);
      if (used + size > width) {
        full = true;
        break;
      }
      result += cluster;
      used += size;
    }
  }
  return result;
}

// Every pane returns through here, so no pane can emit a line wider than itself
// or a block taller than the space it was given.
export function fitPane(lines, width, height) {
  const fitted = lines.map(line => clampToWidth(line, width));
  return [...fitted, ...Array(Math.max(0, height - fitted.length)).fill("")].slice(0, height);
}

export function badge(value, tone = "dim") {
  const label = `[${value.toUpperCase()}]`;
  if (tone === "cyan") return cyan(label);
  if (tone === "green") return green(label);
  if (tone === "yellow") return yellow(label);
  return dim(label);
}
