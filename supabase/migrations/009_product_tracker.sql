-- 009_product_tracker.sql
-- Adds the Product Tracker feature: per-product ad grouping, CPA-aware
-- quadrant classification, time-series metrics history, and cached Claude
-- action-plan reports.

-- ---------------------------------------------------------------------------
-- 1. products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  vertical_category TEXT,
  target_cpa_usd NUMERIC(10,2),
  notes TEXT,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS products_own ON products;
CREATE POLICY products_own ON products FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. extend analyses with product + performance fields
-- ---------------------------------------------------------------------------
ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cpa_usd NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS ctr_pct NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS date_range_start DATE,
  ADD COLUMN IF NOT EXISTS date_range_end DATE,
  ADD COLUMN IF NOT EXISTS age_range TEXT,
  ADD COLUMN IF NOT EXISTS ad_active BOOLEAN,
  ADD COLUMN IF NOT EXISTS quadrant TEXT
    CHECK (quadrant IN ('winner','promising','investigate','loser')),
  ADD COLUMN IF NOT EXISTS quadrant_override TEXT
    CHECK (quadrant_override IN ('winner','promising','investigate','loser'));

CREATE INDEX IF NOT EXISTS idx_analyses_product_id ON analyses(product_id);
CREATE INDEX IF NOT EXISTS idx_analyses_quadrant ON analyses(quadrant);

-- Backfill quadrant from existing spend so legacy rows keep flowing into
-- synthesis after the winner-selection code switches from is_winner to
-- quadrant. spend_usd >= 1000 → winner; spend_usd < 1000 → loser.
UPDATE analyses SET quadrant = CASE
  WHEN spend_usd >= 1000 THEN 'winner'
  WHEN spend_usd IS NOT NULL THEN 'loser'
  ELSE NULL
END WHERE quadrant IS NULL AND spend_usd IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. ad_metrics_history — time series for CTR decay / fatigue detection
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ad_metrics_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  spend_usd NUMERIC(10,2),
  ctr_pct NUMERIC(6,3),
  cpa_usd NUMERIC(10,2)
);
CREATE INDEX IF NOT EXISTS idx_ad_metrics_history_analysis_recorded
  ON ad_metrics_history(analysis_id, recorded_at);

ALTER TABLE ad_metrics_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ad_metrics_history_own ON ad_metrics_history;
CREATE POLICY ad_metrics_history_own ON ad_metrics_history FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM analyses a WHERE a.id = analysis_id AND a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM analyses a WHERE a.id = analysis_id AND a.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. product_recommendations — cached Claude action-plan report per product
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_recommendations (
  product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ads_analyzed INTEGER NOT NULL,
  report JSONB NOT NULL
);

ALTER TABLE product_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_recommendations_own ON product_recommendations;
CREATE POLICY product_recommendations_own ON product_recommendations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.user_id = auth.uid()));
