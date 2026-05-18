-- Product-level audience defaults for concept and angle.
-- TAM, default_persona, default_micro_persona already exist from migration 013.
ALTER TABLE products ADD COLUMN IF NOT EXISTS default_concept TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS default_angle   TEXT;
