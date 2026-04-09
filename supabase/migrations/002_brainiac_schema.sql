-- Brainiac — core schema
-- Apply in Supabase dashboard → SQL editor

-- Extend profiles with usage cap columns
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS daily_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_reset_at date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS monthly_reset_at date NOT NULL DEFAULT DATE_TRUNC('month', NOW())::date,
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active', 'suspended', 'deleted')),
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_scheduled_at timestamptz;

-- Remove Stripe columns not used in this non-commercial build
-- (kept nullable so existing rows don't break if already applied)

-- Consent tracking — timestamped, versioned, IP-logged
CREATE TABLE IF NOT EXISTS user_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (consent_type IN (
    'terms_of_service',
    'privacy_policy',
    'data_aggregation',
    'ad_account_connection'
  )),
  consented_at timestamptz NOT NULL DEFAULT NOW(),
  ip_address text,
  user_agent text,
  legal_version text NOT NULL
);

ALTER TABLE user_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own consents"
  ON user_consents FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own consents"
  ON user_consents FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Analyses
CREATE TABLE IF NOT EXISTS analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('thumbnail', 'channel_batch', 'ad_creative')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'complete', 'failed')),
  input_storage_key text,
  heatmap_storage_key text,
  heatmap_url text,
  roi_data jsonb,
  mean_top_roi_score float,
  source text NOT NULL CHECK (source IN ('manual_upload', 'youtube_channel', 'meta_ads')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  completed_at timestamptz
);

ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own analyses"
  ON analyses FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analyses"
  ON analyses FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Global monthly budget
CREATE TABLE IF NOT EXISTS monthly_budget (
  id serial PRIMARY KEY,
  month date UNIQUE NOT NULL,
  analyses_run integer NOT NULL DEFAULT 0,
  estimated_cost_usd float NOT NULL DEFAULT 0.0,
  budget_cap_usd float NOT NULL DEFAULT 300.0,
  is_exhausted boolean NOT NULL DEFAULT FALSE
);

-- Seed current month row
INSERT INTO monthly_budget (month)
VALUES (DATE_TRUNC('month', NOW())::date)
ON CONFLICT (month) DO NOTHING;

-- Connected ad accounts
CREATE TABLE IF NOT EXISTS connected_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('meta_ads', 'google_ads', 'tiktok_ads')),
  platform_account_id text,
  platform_account_name text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes_granted text[],
  connected_at timestamptz NOT NULL DEFAULT NOW(),
  last_synced_at timestamptz,
  is_active boolean NOT NULL DEFAULT TRUE
);

ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own connected accounts"
  ON connected_accounts FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own connected accounts"
  ON connected_accounts FOR UPDATE USING (auth.uid() = user_id);

-- Ad creatives pulled from connected accounts
CREATE TABLE IF NOT EXISTS ad_creatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  connected_account_id uuid REFERENCES connected_accounts(id) ON DELETE CASCADE,
  platform_creative_id text,
  creative_type text CHECK (creative_type IN ('image', 'video')),
  storage_key text,
  platform_name text,
  platform_status text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE ad_creatives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own ad creatives"
  ON ad_creatives FOR SELECT USING (auth.uid() = user_id);

-- Performance signals linked to creatives
CREATE TABLE IF NOT EXISTS creative_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_creative_id uuid REFERENCES ad_creatives(id) ON DELETE CASCADE,
  analysis_id uuid REFERENCES analyses(id) ON DELETE SET NULL,
  platform text,
  impressions bigint,
  clicks bigint,
  ctr float,
  spend_usd float,
  cpm float,
  roas float,
  recorded_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE creative_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own performance data"
  ON creative_performance FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ad_creatives ac
      WHERE ac.id = creative_performance.ad_creative_id
        AND ac.user_id = auth.uid()
    )
  );

-- Anonymized aggregate benchmark dataset — no user_id, no creative_id
CREATE TABLE IF NOT EXISTS aggregate_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_type text,
  platform text,
  niche_tag text,
  mean_top_roi_score float,
  roi_breakdown jsonb,
  performance_bucket text CHECK (performance_bucket IN (
    'top_quartile', 'upper_mid', 'lower_mid', 'bottom_quartile'
  )),
  recorded_at timestamptz NOT NULL DEFAULT NOW()
);

-- No RLS — no user linkage exists, service role writes only

-- Data deletion audit log
CREATE TABLE IF NOT EXISTS deletion_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, -- intentionally not FK — user may be deleted
  requested_at timestamptz,
  completed_at timestamptz,
  data_purged text[]
);
