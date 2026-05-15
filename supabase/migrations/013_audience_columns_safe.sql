-- 013_audience_columns_safe.sql
--
-- Safe re-run of the audience clarity columns from 012.
-- Migration 012 may have failed if ad_creatives rows with creative_type='video'
-- blocked the CHECK constraint update, rolling back all changes in that script.
-- This migration adds only the required columns (all idempotent via IF NOT EXISTS)
-- and skips the ad_creatives constraint change entirely — the code no longer reads
-- that column, so the constraint is cosmetic.

-- ── Product-level audience defaults ──────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS tam TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS default_persona TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS default_micro_persona TEXT;

-- ── Per-ad audience overrides ─────────────────────────────────────────────────
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS stated_concept TEXT;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS stated_persona TEXT;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS stated_micro_persona TEXT;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS stated_angle TEXT;

-- ── Reference-ad flag ────────────────────────────────────────────────────────
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS is_reference_ad BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_analyses_is_reference_ad
  ON analyses(product_id, is_reference_ad)
  WHERE is_reference_ad = TRUE;
