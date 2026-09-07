-- ---------------------------------------------------------------------------
-- 003 — approve OpenStreetMap Overpass as a source.
--
-- WHY  A B2B product does not sell to a population, it sells to premises. The
--      demo project licenses indoor navigation to shopping centres, and no
--      statistical agency publishes "how many shopping centres are there" as an
--      indicator. Overpass answers it by counting the tagged objects, keylessly
--      and checkably — anyone can re-run the query.
--
-- Same posture as 002: the CHECK is this ADR's allow-list expressed in schema.
-- ---------------------------------------------------------------------------

ALTER TABLE external_cache DROP CONSTRAINT IF EXISTS external_cache_source_check;

ALTER TABLE external_cache ADD CONSTRAINT external_cache_source_check
  CHECK (source IN (
    'worldbank', 'itunes',
    'restcountries', 'eurostat', 'oecd', 'unsd',
    'wikidata', 'datagovil', 'crossref', 'googlebooks',
    'openexchangerates',
    -- ADR-009 amendment, 2026-08-23: premises counts for B2B market sizing
    'overpass'
  ));
