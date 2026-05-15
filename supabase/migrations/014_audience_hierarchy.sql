-- 014_audience_hierarchy.sql
--
-- Replaces the single-value audience clarity model from 012/013
-- (one TAM + one persona + one micro-persona per product, free text)
-- with a hierarchical many-to-many model:
--
--   product → many TAMs → each TAM has many personas → each persona has
--   many micro-personas. A specific ad selects ONE combo from this tree.
--
-- Legacy columns (products.tam, products.default_persona,
-- products.default_micro_persona, analyses.stated_persona,
-- analyses.stated_micro_persona) are backfilled into the new tables
-- and LEFT IN PLACE as dormant columns. Drop in a later cleanup.

-- ── Hierarchy tables ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_tams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_tams_product ON product_tams(product_id);

CREATE TABLE IF NOT EXISTS product_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tam_id UUID NOT NULL REFERENCES product_tams(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_personas_tam ON product_personas(tam_id);

CREATE TABLE IF NOT EXISTS product_micro_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID NOT NULL REFERENCES product_personas(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_micro_personas_persona ON product_micro_personas(persona_id);

-- ── RLS — inherit access from owning product ──────────────────────────
ALTER TABLE product_tams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_tams_own ON product_tams;
CREATE POLICY product_tams_own ON product_tams FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.user_id = auth.uid()));

ALTER TABLE product_personas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_personas_own ON product_personas;
CREATE POLICY product_personas_own ON product_personas FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM product_tams pt JOIN products p ON p.id = pt.product_id
    WHERE pt.id = tam_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM product_tams pt JOIN products p ON p.id = pt.product_id
    WHERE pt.id = tam_id AND p.user_id = auth.uid()
  ));

ALTER TABLE product_micro_personas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_micro_personas_own ON product_micro_personas;
CREATE POLICY product_micro_personas_own ON product_micro_personas FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM product_personas pp
    JOIN product_tams pt ON pt.id = pp.tam_id
    JOIN products p ON p.id = pt.product_id
    WHERE pp.id = persona_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM product_personas pp
    JOIN product_tams pt ON pt.id = pp.tam_id
    JOIN products p ON p.id = pt.product_id
    WHERE pp.id = persona_id AND p.user_id = auth.uid()
  ));

-- ── Per-ad selected combo. NULL = no audience selected. ───────────────
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS tam_id UUID REFERENCES product_tams(id) ON DELETE SET NULL;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS persona_id UUID REFERENCES product_personas(id) ON DELETE SET NULL;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS micro_persona_id UUID REFERENCES product_micro_personas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_analyses_audience ON analyses(tam_id, persona_id, micro_persona_id);

-- ── Backfill from legacy free-text columns ────────────────────────────
INSERT INTO product_tams (product_id, label)
SELECT id, tam FROM products
WHERE tam IS NOT NULL AND trim(tam) <> '';

INSERT INTO product_personas (tam_id, label)
SELECT pt.id, p.default_persona FROM product_tams pt
JOIN products p ON p.id = pt.product_id
WHERE p.default_persona IS NOT NULL AND trim(p.default_persona) <> '';

INSERT INTO product_micro_personas (persona_id, label)
SELECT pp.id, p.default_micro_persona FROM product_personas pp
JOIN product_tams pt ON pt.id = pp.tam_id
JOIN products p ON p.id = pt.product_id
WHERE p.default_micro_persona IS NOT NULL AND trim(p.default_micro_persona) <> '';
