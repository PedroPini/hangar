function queryScorer(query) {
  const normalized = query.trim().toLowerCase();
  const tokens = normalized.split(/\s+/).filter(Boolean);

  return capability => {
    if (!normalized) {
      const scopeScore = capability.scope === "project" ? 100 : 0;
      const kindScore = capability.kind === "skill" ? 2 : 0;
      const collectionScore = capability.collections.length ? 0 : 10;
      return scopeScore + kindScore + collectionScore;
    }
    const identity = capability.id.toLowerCase();
    const fuzzyTokenScore = token => {
      let cursor = -1;
      let score = 0;
      let previous = -2;
      for (const character of token) {
        cursor = identity.indexOf(character, cursor + 1);
        if (cursor < 0) return -1;
        score += cursor === previous + 1 ? 4 : 1;
        if (cursor === 0 || /[\s_-]/.test(identity[cursor - 1])) score += 3;
        previous = cursor;
      }
      return score;
    };

    const tokenScores = tokens.map(token => capability.searchText.includes(token) ? 12 : fuzzyTokenScore(token));
    if (tokenScores.some(score => score < 0)) return -1;

    let score = capability.scope === "project" ? 5 : 0;
    score += tokenScores.reduce((total, tokenScore) => total + tokenScore, 0);
    if (capability.id === normalized) score += 120;
    if (capability.id.startsWith(normalized)) score += 80;
    if (capability.name.toLowerCase().startsWith(normalized)) score += 60;
    if (capability.name.toLowerCase().includes(normalized)) score += 30;
    for (const token of tokens) {
      if (capability.id.startsWith(token)) score += 12;
      if (capability.description.toLowerCase().includes(token)) score += 3;
    }
    return score;
  };
}

function matchesFilters(item, options, toolQuery) {
  return (options.kind === "all" || item.kind === options.kind)
    && (options.scope === "all" || item.scope === options.scope)
    && (!toolQuery || item.tools.some(tool => tool.toLowerCase().includes(toolQuery)));
}

export function matchingCapabilities(capabilities, options) {
  const score = queryScorer(options.query);
  const toolQuery = (options.tool || "").toLowerCase();
  const results = [];

  for (const item of capabilities) {
    if (!matchesFilters(item, options, toolQuery)) continue;
    const value = score(item);
    if (value >= 0) results.push({ item, score: value });
  }

  const ranked = results
    .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name))
    .map(result => result.item);

  // Project capabilities group ahead of global ones. This is the only definition of match
  // order, so the picker, --first, and list can never disagree about the best match.
  return options.scope === "all"
    ? [...ranked.filter(item => item.scope === "project"), ...ranked.filter(item => item.scope === "global")]
    : ranked;
}

export function filterCounts(capabilities, options) {
  const score = queryScorer(options.query);
  const toolQuery = (options.tool || "").toLowerCase();
  const kinds = { all: 0, skill: 0, agent: 0, plugin: 0 };
  const scopes = { all: 0, project: 0, global: 0 };

  for (const item of capabilities) {
    if (toolQuery && !item.tools.some(tool => tool.toLowerCase().includes(toolQuery))) continue;
    if (score(item) < 0) continue;
    if (options.scope === "all" || item.scope === options.scope) {
      kinds.all += 1;
      kinds[item.kind] += 1;
    }
    if (options.kind === "all" || item.kind === options.kind) {
      scopes.all += 1;
      scopes[item.scope] += 1;
    }
  }
  return { kinds, scopes };
}
