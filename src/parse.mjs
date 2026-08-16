import { homedir } from "node:os";
import { relative, sep } from "node:path";
import { stripVTControlCharacters } from "node:util";

const homeDirectory = homedir();

export function frontmatterField(markdown, field) {
  const block = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return "";
  const lines = block[1].split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(new RegExp(`^${field}:\\s*([\\s\\S]*)$`));
    if (!match) continue;
    const value = match[1].trim();
    if (!/^[>|][+-]?$/.test(value)) return value.replace(/^(['"])([\s\S]*)\1$/, "$2");

    const parts = [];
    for (index += 1; index < lines.length && (/^\s/.test(lines[index]) || !lines[index].trim()); index += 1) {
      if (lines[index].trim()) parts.push(lines[index].trim());
    }
    return parts.join(value.startsWith("|") ? "\n" : " ");
  }
  return "";
}

export function tomlField(toml, field) {
  const match = toml.match(new RegExp(`^\\s*${field}\\s*=\\s*(.+)$`, "m"));
  if (!match) return "";
  const raw = match[1].trim();
  if (raw.startsWith('"""') || raw.startsWith("'''")) {
    const quote = raw.slice(0, 3);
    const after = raw.slice(3);
    const sameLineEnd = after.indexOf(quote);
    if (sameLineEnd >= 0) return after.slice(0, sameLineEnd).trim();
    const rest = toml.slice(match.index + match[0].length);
    return `${after}\n${rest.split(quote)[0]}`.trim();
  }
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.replace(/^"|"$/g, "");
    }
  }
  return raw.replace(/^'|'$/g, "");
}

export function withoutTerminalControls(value) {
  return stripVTControlCharacters(String(value))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .replace(/[\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, "");
}

export function plainText(value) {
  return withoutTerminalControls(value)
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[`*>#]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function firstParagraph(markdown) {
  const body = markdown.replace(/^---\s*\r?\n[\s\S]*?\r?\n---/, "");
  return plainText(body.split(/\r?\n\s*\r?\n/).find(part => plainText(part) && !part.trim().startsWith("#")) || "");
}

export function shorten(value, limit = 128) {
  const clean = plainText(value);
  const sentence = clean.match(/^.+?[.!?](?:\s|$)/)?.[0]?.trim() || clean;
  const clause = sentence.split(/\s+[—–]\s+|;\s+/)[0].trim();
  const summary = clause.length >= 32 ? clause : sentence;
  if (summary.length <= limit) return /[.!?]$/.test(summary) ? summary : `${summary}.`;
  return `${summary.slice(0, limit - 1).replace(/\s+\S*$/, "")}…`;
}

export function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "capability";
}

export function humanize(value) {
  const acronyms = new Map([["adhd", "ADHD"], ["ai", "AI"], ["api", "API"], ["ci", "CI"], ["cli", "CLI"], ["gh", "GH"], ["github", "GitHub"], ["imagegen", "ImageGen"], ["llm", "LLM"], ["lsp", "LSP"], ["mcp", "MCP"], ["openai", "OpenAI"], ["pdf", "PDF"], ["rag", "RAG"], ["rxresume", "Reactive Resume"], ["sdk", "SDK"], ["typescript", "TypeScript"], ["ui", "UI"], ["ux", "UX"], ["youtube", "YouTube"]]);
  const lowercase = new Set(["and", "for", "in", "of", "or", "the", "to"]);
  return value.replace(/[-_]+/g, " ").split(" ").map((word, index) => acronyms.get(word.toLowerCase()) || (index && lowercase.has(word) ? word : `${word[0]?.toUpperCase() || ""}${word.slice(1)}`)).join(" ");
}

export function displayPath(path, project) {
  let displayed = path;
  if (path === project || path.startsWith(`${project}${sep}`)) displayed = relative(project, path) || ".";
  else if (path === homeDirectory || path.startsWith(`${homeDirectory}${sep}`)) displayed = `~/${relative(homeDirectory, path)}`;
  return withoutTerminalControls(displayed).replace(/[\t\r\n]/g, "");
}

export function yamlScalarField(yaml, field) {
  const match = yaml.match(new RegExp(`^\\s*${field}:\\s*(.+)$`, "m"));
  if (!match) return "";
  const raw = match[1].trim();
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.replace(/^"|"$/g, "");
    }
  }
  return raw.replace(/^'|'$/g, "");
}
