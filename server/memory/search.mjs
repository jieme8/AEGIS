/**
 * 混合记忆检索：
 *   向量 cosine 相似度 × 0.5
 * + 关键词命中 × 0.3
 * + 时间衰减 × 0.1
 * + 重要性 × 0.05
 * + 访问频次 × 0.01
 */

function daysSince(ts) {
  if (!ts) return 9999;
  return Math.max(0, (Date.now() - ts) / 86400000);
}

function ngrams(s) {
  const t = String(s || "").toLowerCase().replace(/\s+/g, "");
  const out = new Set();
  for (const m of t.match(/[a-z0-9_]+/g) || []) out.add(m);
  const cjk = t.replace(/[a-z0-9_]/g, "");
  for (let i = 0; i < cjk.length - 1; i++) out.add(cjk.slice(i, i + 2));
  return [...out];
}

function unigrams(s) {
  const t = String(s || "").toLowerCase();
  const out = new Set();
  for (const ch of t) {
    if (/[\u4e00-\u9fa5a-z0-9]/.test(ch)) out.add(ch);
  }
  return [...out];
}

function cosine(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function keywordScore(query, key, value) {
  const grams = ngrams(query);
  if (grams.length === 0) return 0;
  const keyStr = String(key || "").toLowerCase();
  const valueStr = String(value || "").toLowerCase();

  let raw = 0;
  for (const g of grams) {
    if (!g) continue;
    if (keyStr.includes(g)) raw += 3;
    if (valueStr.includes(g)) raw += 1;
  }

  if (raw <= 0) {
    // 回退：单字命中
    const chars = unigrams(query);
    if (chars.length === 0) return 0;
    let fallback = 0;
    for (const ch of chars) {
      if (!ch) continue;
      if (keyStr.includes(ch)) fallback += 1.5;
      if (valueStr.includes(ch)) fallback += 0.5;
    }
    const maxFallback = chars.length * 1.5;
    return maxFallback > 0 ? Math.min(1, fallback / maxFallback) * 0.6 : 0;
  }

  const maxPossible = grams.length * 3;
  return Math.min(1, raw / maxPossible);
}

function scoreRecord(rec, queryText, queryEmbedding) {
  const key = rec.key || "";
  const value = rec.value || "";

  const vecScore = rec.embedding && rec.embedding_dim
    ? cosine(queryEmbedding, rec.embedding)
    : 0;

  const kwScore = keywordScore(queryText, key, value);
  // 没有任何语义或关键词命中时，不召回；避免时间/重要性把无关记忆顶上来。
  if (vecScore <= 0 && kwScore <= 0) {
    return { score: 0, vecScore: 0, kwScore: 0, recency: 0, importance: 0 };
  }

  const recency = 1 / (1 + daysSince(rec.updated_at) / 30);
  const imp = typeof rec.importance === "number" ? rec.importance : 0.5;
  const access = Math.min(1, Math.log((rec.access_count || 0) + 1) * 0.1) * 0.01;

  return {
    score: vecScore * 0.5 + kwScore * 0.3 + recency * 0.1 + imp * 0.05 + access,
    vecScore,
    kwScore,
    recency,
    importance: imp,
  };
}

export function searchMemories({
  records,
  queryText,
  queryEmbedding,
  limit = 8,
}) {
  if (!queryText || !queryText.trim()) return [];
  if (!Array.isArray(records)) return [];

  const scored = [];
  for (const rec of records) {
    const result = scoreRecord(rec, queryText, queryEmbedding);
    if (result.score > 0) {
      scored.push({
        key: rec.key,
        value: rec.value,
        type: rec.type,
        score: Math.round(result.score * 1000) / 1000,
        breakdown: {
          vecScore: Math.round(result.vecScore * 1000) / 1000,
          kwScore: Math.round(result.kwScore * 1000) / 1000,
          recency: Math.round(result.recency * 1000) / 1000,
          importance: result.importance,
        },
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.min(Math.max(limit, 1), 30));
}

// 暴露给测试
export { ngrams, unigrams, cosine, keywordScore };
