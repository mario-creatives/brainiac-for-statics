-- 011_per_product_thresholds_and_audit.sql
-- Week 2 + 4 audit items:
--  L1: per-product winner spend threshold (default $1000) so different
--      brands/margins can define what "winner" means for their account.
--  19: quadrant_override_log — every manual classification override is
--      recorded so the pattern library can't be silently poisoned.

-- ---------------------------------------------------------------------------
-- 1. Per-product winner threshold
-- ---------------------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS winner_spend_threshold_usd NUMERIC(10,2) NOT NULL DEFAULT 1000;

-- ---------------------------------------------------------------------------
-- 2. Quadrant override audit log
--    Every PATCH to analyses.quadrant_override writes one row.
--    Pure append-only — never updated, never deleted (cascade only).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quadrant_override_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  previous_override TEXT
    CHECK (previous_override IN ('winner','promising','investigate','loser')),
  new_override TEXT
    CHECK (new_override IN ('winner','promising','investigate','loser')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quadrant_override_log_analysis
  ON quadrant_override_log(analysis_id, changed_at DESC);

ALTER TABLE quadrant_override_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quadrant_override_log_own ON quadrant_override_log;
CREATE POLICY quadrant_override_log_own ON quadrant_override_log FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
