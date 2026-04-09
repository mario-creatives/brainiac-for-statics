-- RPC helpers called from the usage service

-- Atomically increment daily_count and monthly_count on a profile
CREATE OR REPLACE FUNCTION increment_usage_counts(uid uuid, n integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles
  SET
    daily_count   = daily_count + n,
    monthly_count = monthly_count + n
  WHERE id = uid;
END;
$$;

-- Atomically increment the monthly budget row
CREATE OR REPLACE FUNCTION increment_budget(p_month date, p_cost float, p_count integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE monthly_budget
  SET
    analyses_run        = analyses_run + p_count,
    estimated_cost_usd  = estimated_cost_usd + p_cost
  WHERE month = p_month;
END;
$$;
