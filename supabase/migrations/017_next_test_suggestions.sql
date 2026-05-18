-- Per-ad "what to test next" suggestions.
-- Synthesizes status (winner/promising/investigate/loser) + existing comprehensive
-- analysis + cohort of other ads in the same product into a concrete test plan.
-- next_test_quadrant captures the quadrant the suggestion was generated against;
-- when the row's effective quadrant later differs, the UI surfaces the suggestion
-- as stale and offers to regenerate.
ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS next_test_suggestions  JSONB,
  ADD COLUMN IF NOT EXISTS next_test_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_test_quadrant     TEXT;
