import { cyan, dim, green, yellow } from "./ansi.mjs";

export function visibleLength(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, "").length;
}

export function truncate(value, width) {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width === 1) return "…";
  return `${value.slice(0, width - 1)}…`;
}

export function truncateFromStart(value, width) {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width === 1) return "…";
  return `…${value.slice(-(width - 1))}`;
}

export function wrapText(value, width) {
  if (!value || width <= 0) return [];
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    if (word.length > width) {
      if (line) lines.push(line);
      for (let index = 0; index < word.length; index += width) lines.push(word.slice(index, index + width));
      line = "";
    } else if (!line) {
      line = word;
    } else if (line.length + word.length + 1 <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function wrapPath(value, width) {
  if (!value || width <= 0) return [];
  const lines = [];
  let remaining = value;
  while (remaining.length > width) {
    let split = remaining.slice(0, width + 1).lastIndexOf("/");
    if (split < Math.floor(width * 0.4)) split = width;
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
    lines[last] = lines[last].length < width ? `${lines[last]}…` : `${lines[last].slice(0, Math.max(0, width - 1))}…`;
  }
  return lines;
}

export function pad(value, width) {
  return `${value}${" ".repeat(Math.max(0, width - visibleLength(value)))}`;
}

export function badge(value, tone = "dim") {
  const label = `[${value.toUpperCase()}]`;
  if (tone === "cyan") return cyan(label);
  if (tone === "green") return green(label);
  if (tone === "yellow") return yellow(label);
  return dim(label);
}
