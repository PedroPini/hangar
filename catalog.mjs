import { createHash } from "node:crypto";
import { open, readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { displayPath, firstParagraph, frontmatterField, humanize, plainText, shorten, slugify, tomlField, withoutTerminalControls, yamlScalarField } from "./src/parse.mjs";

export { frontmatterField, shorten, tomlField } from "./src/parse.mjs";

const homeDirectory = homedir();
const maximumCapabilityFileBytes = 1024 * 1024;
const maximumCapabilityBytes = 256 * 1024 * 1024;
const maximumConcurrentReads = 16;
const unreadablePathCodes = new Set(["ENOENT", "ENOTDIR", "EACCES", "ELOOP"]);
const skippedDirectories = new Set([".git", ".venv", "node_modules"]);
const pluginManifestFolders = [
  { folder: ".codex-plugin", tool: "Codex" },
  { folder: ".claude-plugin", tool: "Claude Code" },
  { folder: ".cursor-plugin", tool: "Cursor" }
];
const pluginManifestFolderNames = new Set(pluginManifestFolders.map(item => item.folder));
const capabilityAdapters = [
  { folder: ".agents", tool: "Shared", scopes: ["global", "project"], kinds: ["skill", "agent"], ancestors: true },
  { folder: ".claude", tool: "Claude Code", scopes: ["global", "project"], kinds: ["skill", "agent"], ancestors: true },
  { folder: ".codex", tool: "Codex", scopes: ["global", "project"], kinds: ["skill", "agent"], ancestors: true },
  { folder: ".cursor", tool: "Cursor", scopes: ["global", "project"], kinds: ["skill", "agent"], ancestors: true },
  { folder: ".gemini", tool: "Gemini CLI", scopes: ["global", "project"], kinds: ["skill", "agent"], ancestors: true },
  { folder: ".copilot", tool: "GitHub Copilot", scopes: ["global"], kinds: ["skill"] },
  { folder: ".github", tool: "GitHub Copilot", scopes: ["project"], kinds: ["skill", "agent"], ancestors: true }
];

export function capabilityLocations(projectDirectory = process.cwd()) {
  const project = resolve(projectDirectory);
  const locations = [];
  const add = (scope, tool, kind, directory, maxDepth = 2, mustInclude = "") => {
    locations.push({ scope, tool, kind, directory, maxDepth, mustInclude });
  };

  for (const adapter of capabilityAdapters) {
    for (const scope of adapter.scopes) {
      if (scope === "project" && project === homeDirectory) continue;
      const root = scope === "global" ? homeDirectory : project;
      for (const kind of adapter.kinds) {
        add(scope, adapter.tool, kind, join(root, adapter.folder, `${kind}s`), kind === "skill" ? 2 : 1);
      }
    }
  }

  add("global", "Codex", "skill", join(homeDirectory, ".codex", "plugins", "cache"), 7, "skills");
  add("global", "Codex", "plugin", join(homeDirectory, ".codex", "plugins", "cache"), 7);
  if (project !== homeDirectory) {
    add("project", "Shared", "skill", join(project, "skills"));
    add("project", "Shared", "agent", join(project, "agents"), 1);
    for (const adapter of pluginManifestFolders) add("project", adapter.tool, "plugin", join(project, adapter.folder), 0);
  }
  return locations;
}

async function projectAncestors(project) {
  const ancestors = [];
  let directory = project;

  while (directory !== homeDirectory && dirname(directory) !== directory) {
    if (directory !== project) ancestors.push(directory);
    try {
      await stat(join(directory, ".git"));
      break;
    } catch (error) {
      if (!isUnreadablePath(error)) throw error;
    }
    directory = dirname(directory);
  }
  return ancestors;
}

function isUnreadablePath(error) {
  return unreadablePathCodes.has(error.code);
}

function containsPath(parent, child) {
  return parent === child || child.startsWith(`${parent}${sep}`);
}

async function canonicalDiscoveryRoots(locations, project) {
  let projectCanonical = project;
  try {
    projectCanonical = await realpath(project);
  } catch (error) {
    if (!isUnreadablePath(error)) throw error;
  }

  const candidates = (await Promise.all(locations.map(async location => {
    try {
      return { location, logical: resolve(location.directory), canonical: await realpath(location.directory) };
    } catch (error) {
      if (isUnreadablePath(error)) return null;
      throw error;
    }
  }))).filter(Boolean);
  const globalRoots = new Map();
  const allowedRoots = new Map();
  const add = (map, kind, path) => map.set(kind, [...new Set([...(map.get(kind) || []), path])]);

  for (const candidate of candidates.filter(item => item.location.scope === "global")) {
    add(globalRoots, candidate.location.kind, candidate.canonical);
    add(allowedRoots, candidate.location.kind, candidate.canonical);
  }
  for (const candidate of candidates.filter(item => item.location.scope === "project")) {
    const expected = containsPath(project, candidate.logical)
      ? join(projectCanonical, relative(project, candidate.logical))
      : candidate.logical;
    const trusted = candidate.canonical === candidate.logical
      || candidate.canonical === expected
      || (globalRoots.get(candidate.location.kind) || []).some(root => containsPath(root, candidate.canonical));
    if (trusted) add(allowedRoots, candidate.location.kind, candidate.canonical);
  }
  return allowedRoots;
}

let remainingCapabilityBytes = maximumCapabilityBytes;

async function readCapabilityFile(path) {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size > maximumCapabilityFileBytes) {
      const error = new Error(`Capability file is larger than 1 MiB: ${path}`);
      error.code = "EFBIG";
      throw error;
    }
    if (size > remainingCapabilityBytes) {
      const error = new Error(`Capability metadata budget of 256 MiB is exhausted: ${path}`);
      error.code = "EFBIG";
      throw error;
    }
    remainingCapabilityBytes -= size;
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function claudePluginLocations(project) {
  let installed;
  try {
    installed = JSON.parse(await readFile(join(homeDirectory, ".claude", "plugins", "installed_plugins.json"), "utf8"));
  } catch (error) {
    if (isUnreadablePath(error) || error instanceof SyntaxError) return [];
    throw error;
  }

  const locations = [];
  for (const [pluginKey, installations] of Object.entries(installed?.plugins || {})) {
    for (const installation of Array.isArray(installations) ? installations : []) {
      const installPath = installation?.installPath;
      if (typeof installPath !== "string" || !isAbsolute(installPath)) continue;
      const root = resolve(installPath);
      if (!containsPath(homeDirectory, root)) continue;
      const projectScoped = installation.scope === "local" || installation.scope === "project";
      const projectPath = installation.projectPath;
      const projectRoot = typeof projectPath === "string" && isAbsolute(projectPath) ? resolve(projectPath) : "";
      if (projectScoped && (!projectRoot || !containsPath(projectRoot, project))) continue;
      const scope = projectScoped ? "project" : "global";
      locations.push(
        {
          scope,
          tool: "Claude Code",
          kind: "plugin",
          directory: root,
          maxDepth: 2,
          mustInclude: "",
          pluginId: pluginKey.split("@")[0],
          pluginVersion: installation.version || ""
        },
        { scope, tool: "Claude Code", kind: "skill", directory: join(root, "skills"), maxDepth: 4, mustInclude: "" },
        { scope, tool: "Claude Code", kind: "agent", directory: join(root, "agents"), maxDepth: 3, mustInclude: "" }
      );
    }
  }
  return locations;
}

export async function resolvedCapabilityLocations(projectDirectory = process.cwd()) {
  const project = resolve(projectDirectory);
  const locations = capabilityLocations(project);

  for (const ancestor of await projectAncestors(project)) {
    for (const adapter of capabilityAdapters.filter(item => item.ancestors)) {
      for (const kind of adapter.kinds) {
        locations.push({
          scope: "project",
          tool: adapter.tool,
          kind,
          directory: join(ancestor, adapter.folder, `${kind}s`),
          maxDepth: kind === "skill" ? 2 : 1,
          mustInclude: ""
        });
      }
    }
    for (const adapter of pluginManifestFolders) {
      locations.push({
        scope: "project",
        tool: adapter.tool,
        kind: "plugin",
        directory: join(ancestor, adapter.folder),
        maxDepth: 0,
        mustInclude: ""
      });
    }
  }
  locations.push(...await claudePluginLocations(project));

  const unique = new Map();
  for (const location of locations) {
    const key = [location.scope, location.tool, location.kind, location.directory, location.mustInclude, location.pluginId].join("\0");
    if (!unique.has(key)) unique.set(key, location);
  }
  return [...unique.values()];
}

async function discoverFiles(location, allowedRoots) {
  const found = [];
  const visited = new Set();
  const allowed = path => allowedRoots.some(root => containsPath(root, path));

  async function walk(directory, depth) {
    let canonical;
    let entries;
    try {
      canonical = await realpath(directory);
      if (!allowed(canonical)) return;
      if (visited.has(canonical)) return;
      visited.add(canonical);
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isUnreadablePath(error)) return;
      throw error;
    }

    for (const entry of entries) {
      const path = join(directory, entry.name);
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const canonicalTarget = await realpath(path);
          if (!allowed(canonicalTarget)) continue;
          const target = await stat(path);
          isDirectory = target.isDirectory();
          isFile = target.isFile();
        } catch {
          continue;
        }
      }

      if (isDirectory && depth < location.maxDepth && !skippedDirectories.has(entry.name)) {
        await walk(path, depth + 1);
      } else if (isFile) {
        const wanted = location.kind === "skill"
          ? entry.name === "SKILL.md"
          : location.kind === "plugin"
            ? entry.name === "plugin.json" && pluginManifestFolderNames.has(basename(directory))
            : /\.(md|toml)$/i.test(entry.name);
        const included = !location.mustInclude || path.split(sep).includes(location.mustInclude);
        if (wanted && included) found.push({ path, location });
      }
    }
  }

  await walk(location.directory, 0);
  if (location.kind === "plugin" && !found.length && location.pluginId) {
    found.push({ path: location.directory, location, synthetic: true });
  }
  return found;
}

async function skillPresentation(path) {
  try {
    const yaml = await readCapabilityFile(join(dirname(path), "agents", "openai.yaml"));
    return {
      name: yamlScalarField(yaml, "display_name"),
      description: yamlScalarField(yaml, "short_description")
    };
  } catch (error) {
    if (isUnreadablePath(error)) return { name: "", description: "" };
    throw error;
  }
}

const collectionManifestCache = new Map();

async function readCollectionManifest(path) {
  if (!collectionManifestCache.has(path)) {
    collectionManifestCache.set(path, (async () => {
      try {
        const manifest = JSON.parse(await readCapabilityFile(path));
        const interfaceMetadata = manifest.interface || {};
        const rawId = manifest.name || basename(dirname(dirname(path)));
        const rawName = interfaceMetadata.displayName || interfaceMetadata.display_name || rawId;
        const rawDescription = interfaceMetadata.shortDescription || interfaceMetadata.short_description || manifest.description || "";
        const name = /^[a-z0-9_-]+$/.test(rawName) ? humanize(rawName) : plainText(rawName);
        return { id: slugify(rawId), name, description: shorten(rawDescription || `${name} capability collection.`), sourcePath: path };
      } catch (error) {
        if (isUnreadablePath(error) || error instanceof SyntaxError) return null;
        throw error;
      }
    })());
  }
  return collectionManifestCache.get(path);
}

async function collectionFor(path, project) {
  let directory = dirname(path);
  for (let depth = 0; depth < 9; depth += 1) {
    for (const folder of [".codex-plugin", ".claude-plugin", ".cursor-plugin"]) {
      const collection = await readCollectionManifest(join(directory, folder, "plugin.json"));
      if (collection) {
        const { sourcePath, ...metadata } = collection;
        return { ...metadata, path: displayPath(sourcePath, project) };
      }
    }
    if (directory === homeDirectory || dirname(directory) === directory) break;
    directory = dirname(directory);
  }
  return null;
}

async function readPluginCapability(discovery, project) {
  let content;
  let manifest = {};
  if (discovery.synthetic) {
    try {
      content = await readCapabilityFile(join(discovery.path, "README.md"));
    } catch (error) {
      if (!isUnreadablePath(error)) throw error;
      content = discovery.location.pluginId;
    }
  } else {
    content = await readCapabilityFile(discovery.path);
    manifest = JSON.parse(content);
  }

  const { scope, tool } = discovery.location;
  const pluginRoot = discovery.synthetic ? discovery.path : dirname(dirname(discovery.path));
  const interfaceMetadata = manifest.interface || {};
  const rawId = plainText(manifest.name || discovery.location.pluginId || basename(pluginRoot));
  const rawName = interfaceMetadata.displayName || interfaceMetadata.display_name || rawId;
  const name = /^[a-z0-9_-]+$/.test(rawName) ? humanize(rawName) : plainText(rawName);
  const readmeDescription = discovery.synthetic ? firstParagraph(content) : "";
  const rawDescription = interfaceMetadata.shortDescription || interfaceMetadata.short_description || manifest.description || readmeDescription;
  const rawDetail = interfaceMetadata.longDescription || interfaceMetadata.long_description || rawDescription;
  const description = shorten(rawDescription || `${name} plugin available through ${tool}.`);
  const detail = shorten(rawDetail || description, 360);
  const version = manifest.version || discovery.location.pluginVersion || "";
  const author = plainText(typeof manifest.author === "string" ? manifest.author : manifest.author?.name || "");
  const sourcePath = discovery.synthetic ? pluginRoot : discovery.path;
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);

  return {
    key: `plugin:${slugify(rawId)}`,
    hash,
    id: slugify(rawId),
    name,
    kind: "plugin",
    scope,
    description,
    detail,
    searchText: `${name} ${rawId} ${description} ${detail} plugin ${scope} ${tool} ${version} ${author} ${sourcePath}`.toLowerCase(),
    tools: [tool],
    collections: [],
    contents: { skills: 0, agents: 0 },
    version,
    author,
    manifest: !discovery.synthetic,
    path: displayPath(sourcePath, project),
    sources: [{ scope, tool, path: displayPath(sourcePath, project) }]
  };
}

async function readCapability(discovery, project) {
  if (discovery.location.kind === "plugin") return readPluginCapability(discovery, project);
  const content = await readCapabilityFile(discovery.path);
  const { kind, scope, tool } = discovery.location;
  const fallbackName = kind === "skill" ? basename(dirname(discovery.path)) : basename(discovery.path, ".md");
  const isToml = discovery.path.toLowerCase().endsWith(".toml");
  const heading = isToml ? "" : content.match(/^#\s+(.+)$/m)?.[1] || "";
  const metadataName = isToml ? tomlField(content, "name") : frontmatterField(content, "name");
  const rawName = plainText(metadataName || heading || fallbackName);
  const presentation = kind === "skill" ? await skillPresentation(discovery.path) : { name: "", description: "" };
  const name = plainText(presentation.name) || (/^[a-z0-9_-]+$/.test(rawName) ? humanize(rawName) : rawName);
  const rawDescription = (isToml ? tomlField(content, "description") : frontmatterField(content, "description")) || (isToml ? "" : firstParagraph(content));
  const description = shorten(presentation.description || rawDescription || `${humanize(kind)} available through ${tool}.`);
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  const collection = await collectionFor(discovery.path, project);
  const collections = collection ? [collection] : [];
  const collectionText = collections.flatMap(item => [item.name, item.description]).join(" ");

  return {
    key: `${kind}:${slugify(rawName)}`,
    hash,
    id: slugify(rawName),
    name,
    kind,
    scope,
    description,
    detail: shorten(rawDescription || description, 360),
    searchText: `${name} ${rawName} ${description} ${rawDescription} ${kind} ${scope} ${tool} ${collectionText} ${discovery.path}`.toLowerCase(),
    tools: [tool],
    collections,
    path: displayPath(discovery.path, project),
    sources: [{ scope, tool, path: displayPath(discovery.path, project) }]
  };
}

function codexBuiltInAgents() {
  return [
    ["default", "General-purpose fallback agent."],
    ["worker", "Execution-focused agent for implementation and fixes."],
    ["explorer", "Read-heavy agent for codebase exploration."]
  ].map(([id, description]) => ({
    key: `agent:${id}`,
    hash: createHash("sha256").update(`codex-built-in:${id}`).digest("hex").slice(0, 16),
    id,
    name: humanize(id),
    kind: "agent",
    scope: "global",
    description,
    detail: description,
    searchText: `${id} ${description} agent global codex built in`.toLowerCase(),
    tools: ["Codex"],
    collections: [],
    path: `Codex built-in: ${id}`,
    sources: [{ scope: "global", tool: "Codex", path: `Codex built-in: ${id}` }]
  }));
}

function isNewerVersion(candidate, current) {
  if (!candidate || candidate === "unknown") return false;
  if (!current || current === "unknown") return true;
  return candidate.localeCompare(current, undefined, { numeric: true, sensitivity: "base" }) > 0;
}

async function settledWithLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index]) };
      } catch {
        results[index] = { status: "rejected" };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export async function scanCapabilities(projectDirectory = process.cwd()) {
  const project = resolve(projectDirectory);
  remainingCapabilityBytes = maximumCapabilityBytes;
  const locations = await resolvedCapabilityLocations(project);
  const allowedRoots = await canonicalDiscoveryRoots(locations, project);
  const discoveries = (await Promise.all(locations.map(location => discoverFiles(location, allowedRoots.get(location.kind) || [])))).flat();
  const settled = await settledWithLimit(discoveries, maximumConcurrentReads, item => readCapability(item, project));
  const parsed = [
    ...settled.filter(result => result.status === "fulfilled").map(result => result.value),
    ...codexBuiltInAgents()
  ];
  const grouped = new Map();

  for (const item of parsed) {
    const existing = grouped.get(item.key);
    if (!existing) {
      item.hashes = new Set([item.hash]);
      grouped.set(item.key, item);
      continue;
    }
    existing.hashes.add(item.hash);
    existing.sources.push(...item.sources);
    existing.tools = [...new Set([...existing.tools, ...item.tools])];
    existing.collections = [...new Map([...existing.collections, ...item.collections].map(collection => [collection.id, collection])).values()];
    existing.searchText += ` ${item.searchText}`;
    const preferProject = item.scope === "project" && existing.scope !== "project";
    const preferPluginVersion = item.kind === "plugin" && item.scope === existing.scope && isNewerVersion(item.version, existing.version);
    if (preferProject || preferPluginVersion) {
      existing.scope = item.scope;
      existing.name = item.name;
      existing.description = item.description;
      existing.detail = item.detail;
      existing.path = item.path;
      if (item.kind === "plugin") {
        existing.version = item.version;
        existing.author = item.author;
        existing.manifest = item.manifest;
      }
    }
  }

  const groupedCapabilities = [...grouped.values()];
  for (const plugin of groupedCapabilities.filter(item => item.kind === "plugin")) {
    plugin.contents = {
      skills: groupedCapabilities.filter(item => item.kind === "skill" && item.collections.some(collection => collection.id === plugin.id)).length,
      agents: groupedCapabilities.filter(item => item.kind === "agent" && item.collections.some(collection => collection.id === plugin.id)).length
    };
    plugin.searchText += ` ${plugin.contents.skills} skills ${plugin.contents.agents} agents`;
  }

  const capabilities = groupedCapabilities
    .map(({ key, hash, hashes, ...item }) => ({ ...item, sourceCount: item.sources.length, variantCount: hashes.size }))
    .sort((left, right) => (left.scope === right.scope ? left.name.localeCompare(right.name) : left.scope === "project" ? -1 : 1));

  return {
    project: withoutTerminalControls(project).replace(/[\t\r\n]/g, ""),
    projectName: plainText(basename(project)),
    scannedAt: new Date().toISOString(),
    unreadableCount: settled.filter(result => result.status === "rejected").length,
    capabilities
  };
}

export function referenceFor(capability, host = "codex") {
  if (capability.kind === "plugin") return host === "name" ? capability.id : capability.path;
  if (host === "path") return capability.path;
  if (host === "name") return capability.id;
  if (host === "claude" && capability.kind === "skill") return `/${capability.id}`;
  return capability.kind === "skill" ? `$${capability.id}` : `@${capability.id}`;
}
