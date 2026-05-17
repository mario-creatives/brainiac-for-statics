-- 015_concept_angle_dedup.sql
--
-- DB-level deduplication for concept and angle, mirroring the audience
-- hierarchy from 014 (product_tams / product_personas / product_micro_personas).
--
-- Unlike that hierarchy, concept and angle are NOT nested — both are
-- product-scoped peers. Each ad references one concept_id and one angle_id
-- via the analyses table. The same angle text can appear under many concepts
-- (the AudienceProfileMap's concept→angle visual nesting is a per-ad usage
-- grouping, not a structural relationship).
--
-- Legacy text columns analyses.stated_concept / analyses.stated_angle are
-- left in place as dormant fallbacks for safe rollback.

-- ── Dedup tables ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_concepts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_concepts_product ON product_concepts(product_id);

CREATE TABLE IF NOT EXISTS product_angles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_angles_product ON product_angles(product_id);

-- ── RLS — inherit access from owning product (same shape as product_tams) ──
ALTER TABLE product_concepts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_concepts_own ON product_concepts;
CREATE POLICY product_concepts_own ON product_concepts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.user_id = auth.uid()));

ALTER TABLE product_angles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_angles_own ON product_angles;
CREATE POLICY product_angles_own ON product_angles FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.user_id = auth.uid()));

-- ── Per-ad FK columns. NULL = legacy/no value. ────────────────────────
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS concept_id UUID REFERENCES product_concepts(id) ON DELETE SET NULL;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS angle_id   UUID REFERENCES product_angles(id)   ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_analyses_concept_angle ON analyses(concept_id, angle_id);

-- ── Backfill from stated_* (preferred) or audience_inference JSON ─────
-- DISTINCT ON (product_id, LOWER(label)) collapses case-insensitive dupes
-- while preserving the lexicographically lowest casing.
WITH concept_candidates AS (
  SELECT a.product_id,
         COALESCE(
           NULLIF(TRIM(a.stated_concept), ''),
           NULLIF(TRIM(a.comprehensive_analysis -> 'audience_inference' ->> 'inferred_concept'), '')
         ) AS label
  FROM analyses a
  WHERE a.product_id IS NOT NULL
),
concept_dedup AS (
  SELECT DISTINCT ON (product_id, LOWER(label)) product_id, label
  FROM concept_candidates
  WHERE label IS NOT NULL
  ORDER BY product_id, LOWER(label), label
)
INSERT INTO product_concepts (product_id, label) SELECT product_id, label FROM concept_dedup;

WITH angle_candidates AS (
  SELECT a.product_id,
         COALESCE(
           NULLIF(TRIM(a.stated_angle), ''),
           NULLIF(TRIM(a.comprehensive_analysis -> 'audience_inference' ->> 'inferred_angle'), '')
         ) AS label
  FROM analyses a
  WHERE a.product_id IS NOT NULL
),
angle_dedup AS (
  SELECT DISTINCT ON (product_id, LOWER(label)) product_id, label
  FROM angle_candidates
  WHERE label IS NOT NULL
  ORDER BY product_id, LOWER(label), label
)
INSERT INTO product_angles (product_id, label) SELECT product_id, label FROM angle_dedup;

UPDATE analyses a SET concept_id = pc.id
FROM product_concepts pc
WHERE a.product_id = pc.product_id AND a.concept_id IS NULL
  AND LOWER(TRIM(COALESCE(
        NULLIF(TRIM(a.stated_concept), ''),
        NULLIF(TRIM(a.comprehensive_analysis -> 'audience_inference' ->> 'inferred_concept'), '')
      ))) = LOWER(pc.label);

UPDATE analyses a SET angle_id = pa.id
FROM product_angles pa
WHERE a.product_id = pa.product_id AND a.angle_id IS NULL
  AND LOWER(TRIM(COALESCE(
        NULLIF(TRIM(a.stated_angle), ''),
        NULLIF(TRIM(a.comprehensive_analysis -> 'audience_inference' ->> 'inferred_angle'), '')
      ))) = LOWER(pa.label);
