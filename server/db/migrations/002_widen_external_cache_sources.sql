-- ---------------------------------------------------------------------------
-- 002 — widen external_cache.source to the approved Tier-2 sources.
--
-- WHY  001 pinned the CHECK to ('worldbank','itunes') because ADR-009 approved
--      exactly those two. The approved set has grown, and the constraint is the
--      thing that would otherwise reject a cached response at write time —
--      silently, because setCached is called best-effort with .catch(() => {}).
--      A rejected insert there would not fail a request; it would just make
--      every call a live call, and the offline demo would quietly stop working.
--
-- The constraint is kept rather than dropped. It is the schema-level statement
-- of ADR-009's allow-list: a source that is not approved cannot be cached, and
-- therefore cannot reach a document.
-- ---------------------------------------------------------------------------

ALTER TABLE external_cache DROP CONSTRAINT IF EXISTS external_cache_source_check;

ALTER TABLE external_cache ADD CONSTRAINT external_cache_source_check
  CHECK (source IN (
    -- ADR-009, original
    'worldbank',
    'itunes',
    -- ADR-009 amendment, 2026-08-23: Tier-2 keyless APIs
    'restcountries',
    'eurostat',
    'oecd',
    'unsd',
    'wikidata',
    'datagovil',
    'crossref',
    'googlebooks',
    -- free tier, requires a key; degrades to unvalidated without one
    'openexchangerates'
  ));

-- fetched_at is read to decide whether a cached row is stale enough to refresh.
-- Unindexed it was a sequential scan over the whole cache on every lookup.
CREATE INDEX IF NOT EXISTS idx_external_cache_fetched ON external_cache(source, fetched_at);
