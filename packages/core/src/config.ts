import { db } from '@rook/db';
import { defaultConfig, type EngineConfig } from '@rook/engine';

/**
 * Engine config lives in the versioned `config` table under key 'engine';
 * the latest effective row wins. Falls back to engine defaults (the Phase 0
 * values) when unset. Deep-merged so partial overrides are safe.
 */
export async function loadConfig(now: Date): Promise<EngineConfig> {
  const rows = await db()`
    select value from config
    where key = 'engine' and effective_at <= ${now}
    order by effective_at desc limit 1
  `;
  const base = structuredClone(defaultConfig);
  if (rows.length === 0) return base;
  return deepMerge(base, rows[0]!.value as Partial<EngineConfig>) as EngineConfig;
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
