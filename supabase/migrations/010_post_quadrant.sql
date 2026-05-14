-- 010_post_quadrant.sql
-- Post-quadrant cleanup:
-- 1. Rebuild is_winner so it agrees with the quadrant source of truth.
-- 2. Add a reanalyze_locked_at column for concurrent-run guarding in
--    /api/analyze/reanalyze (avoids the same ad being re-analyzed twice
--    in parallel from two browser tabs).

-- ---------------------------------------------------------------------------
-- 1. Drop the old spend-based generated column, replace with a quadrant-based
--    one. Anything in the codebase that still reads is_winner now reads the
--    same boolean the synthesis layer reads.
-- ---------------------------------------------------------------------------
ALTER TABLE analyses DROP COLUMN IF EXISTS is_winner;

ALTER TABLE analyses
  ADD COLUMN is_winner BOOLEAN
  GENERATED ALWAYS AS (
    COALESCE(quadrant_override, quadrant) IN ('winner','promising')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_analyses_is_winner ON analyses(is_winner);

-- ---------------------------------------------------------------------------
-- 2. Concurrent-run guard for /api/analyze/reanalyze
-- ---------------------------------------------------------------------------
ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS reanalyze_locked_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 3. synthesis_errors — surface silent pass failures
-- ---------------------------------------------------------------------------
-- Previously the three synthesis passes (winner patterns, anti-patterns,
-- framework guard rails) swallowed Claude errors in non-fatal catches. The
-- pattern library would silently stop growing and the user had no signal.
-- This table records every failure so the Historical Analysis page can
-- show a "last run failed: <reason>" banner.
CREATE TABLE IF NOT EXISTS synthesis_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pass TEXT NOT NULL CHECK (pass IN ('winner_patterns','anti_patterns','framework_principles','baseline_evolution')),
  error_message TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_synthesis_errors_occurred_at ON synthesis_errors(occurred_at DESC);
ALTER TABLE synthesis_errors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS synthesis_errors_service_only ON synthesis_errors;
CREATE POLICY synthesis_errors_service_only ON synthesis_errors FOR ALL TO service_role USING (true);
