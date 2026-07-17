import { db } from '@rook/db';
import { defaultConfig, type EngineConfig } from '@rook/engine';

/**
 * Engine config lives in the versioned `config` table under key 'engine' as
 * an append-only sequence of partial patches; the effective config is the
 * defaults with every effective patch folded in order. (Latest-row-wins was
 * a bug: a rate-limit patch silently dropped an earlier settlement patch.)
 */
export async function loadConfig(now: Date): Promise<EngineConfig> {
  const rows = await db()`
    select value from config
    where key = 'engine' and effective_at <= ${now}
    order by effective_at asc
  `;
  let merged: unknown = structuredClone(defaultConfig);
  for (const row of rows) {
    merged = deepMerge(merged, row.value as Partial<EngineConfig>);
  }
  return merged as EngineConfig;
}

export async function setConfig(patch: object, effectiveAt: Date): Promise<void> {
  await db()`insert into config (key, value, effective_at)
    values ('engine', ${db().json(JSON.parse(JSON.stringify(patch)))}, ${effectiveAt})`;
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (
    typeof base !== 'object' || base === null || Array.isArray(base) ||
    typeof patch !== 'object' || patch === null || Array.isArray(patch)
  ) {
    return patch === undefined ? base : patch;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = deepMerge(out[k], v);
  }
  return out;
}
