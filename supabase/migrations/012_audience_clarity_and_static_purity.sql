-- 012_audience_clarity_and_static_purity.sql
--
-- 1. Audience Clarity Module: TAM / persona / micro-persona at product level,
--    concept / persona / micro-persona / angle at ad level. These are the
--    "user-stated" values that Claude's audience_inference will be compared
--    against to produce the targeting-mismatch flag.
-- 2. North-star "reference ad" flag per product.
-- 3. Static-ad purity: drop legacy 'video' option from ad_creatives.creative_type.
--    This product is static-only; no row has ever been written with 'video'.

-- ────────────────────────────────────────────────────────────────────────────
-- Product-level audience defaults
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS tam TEXT,
  ADD COLUMN IF NOT EXISTS default_persona TEXT,
  ADD COLUMN IF NOT EXISTS default_micro_persona TEXT;

-- ────────────────────────────────────────────────────────────────────────────
-- Per-ad audience overrides (user-stated)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS stated_concept TEXT,
  ADD COLUMN IF NOT EXISTS stated_persona TEXT,
  ADD COLUMN IF NOT EXISTS stated_micro_persona TEXT,
  ADD COLUMN IF NOT EXISTS stated_angle TEXT;

-- ────────────────────────────────────────────────────────────────────────────
-- Reference ad (the "north star" winner per product) — strategists keep one
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS is_reference_ad BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_analyses_is_reference_ad
  ON analyses(product_id, is_reference_ad)
  WHERE is_reference_ad = TRUE;

-- ────────────────────────────────────────────────────────────────────────────
-- Static-ad purity: drop legacy 'video' from ad_creatives.creative_type
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE ad_creatives DROP CONSTRAINT IF EXISTS ad_creatives_creative_type_check;
ALTER TABLE ad_creatives
  ADD CONSTRAINT ad_creatives_creative_type_check CHECK (creative_type IN ('image'));
