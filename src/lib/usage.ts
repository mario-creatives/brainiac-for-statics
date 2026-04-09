import { supabaseServer } from '@/lib/supabase-server'

export const DAILY_LIMIT = 10000
export const MONTHLY_LIMIT = 10000
export const COST_PER_ANALYSIS = parseFloat(process.env.COST_PER_ANALYSIS_USD ?? '0.01')
export const MONTHLY_BUDGET_CAP = parseFloat(process.env.MONTHLY_BUDGET_CAP_USD ?? '300.00')

function startOfMonth(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function checkUserLimits(
  userId: string
): Promise<{ allowed: boolean; reason?: string; resets_at?: string; limit_type?: string }> {
  const { data: profile, error } = await supabaseServer
    .from('profiles')
    .select('daily_count, monthly_count, daily_reset_at, monthly_reset_at')
    .eq('id', userId)
    .single()

  if (error || !profile) return { allowed: false, reason: 'Profile not found.' }

  const todayStr = today()
  const thisMonth = startOfMonth(new Date())

  // Reset daily count if stale
  if (profile.daily_reset_at < todayStr) {
    await supabaseServer
      .from('profiles')
      .update({ daily_count: 0, daily_reset_at: todayStr })
      .eq('id', userId)
    profile.daily_count = 0
  }

  // Reset monthly count if stale
  if (profile.monthly_reset_at < thisMonth) {
    await supabaseServer
      .from('profiles')
      .update({ monthly_count: 0, monthly_reset_at: thisMonth })
      .eq('id', userId)
    profile.monthly_count = 0
  }

  if (profile.daily_count >= DAILY_LIMIT) {
    const tomorrow = new Date()
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    tomorrow.setUTCHours(0, 0, 0, 0)
    return {
      allowed: false,
      reason: `Daily limit of ${DAILY_LIMIT} analyses reached. Resets at midnight UTC.`,
      resets_at: tomorrow.toISOString(),
      limit_type: 'daily',
    }
  }

  if (profile.monthly_count >= MONTHLY_LIMIT) {
    const nextMonth = new Date()
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 1)
    nextMonth.setUTCHours(0, 0, 0, 0)
    return {
      allowed: false,
      reason: `Monthly limit of ${MONTHLY_LIMIT} analyses reached. Resets the first of next month.`,
      resets_at: nextMonth.toISOString(),
      limit_type: 'monthly',
    }
  }

  return { allowed: true }
}

export async function checkGlobalBudget(): Promise<{
  allowed: boolean
  reason?: string
  resets_at?: string
  limit_type?: string
}> {
  const thisMonth = startOfMonth(new Date())

  // Upsert current month row if missing
  await supabaseServer
    .from('monthly_budget')
    .upsert({ month: thisMonth }, { onConflict: 'month', ignoreDuplicates: true })

  const { data: budget } = await supabaseServer
    .from('monthly_budget')
    .select('*')
    .eq('month', thisMonth)
    .single()

  if (!budget) return { allowed: false, reason: 'Budget record not found.' }

  if (budget.is_exhausted || budget.estimated_cost_usd >= MONTHLY_BUDGET_CAP) {
    if (!budget.is_exhausted) {
      await supabaseServer
        .from('monthly_budget')
        .update({ is_exhausted: true })
        .eq('month', thisMonth)
    }
    const nextMonth = new Date()
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 1)
    nextMonth.setUTCHours(0, 0, 0, 0)
    return {
      allowed: false,
      reason: 'Global analysis capacity reached for this month.',
      resets_at: nextMonth.toISOString(),
      limit_type: 'global_budget',
    }
  }

  return { allowed: true }
}

export async function incrementUsage(userId: string, count = 1): Promise<void> {
  // Increment user counts
  await supabaseServer.rpc('increment_usage_counts', { uid: userId, n: count })

  // Increment global budget
  const thisMonth = startOfMonth(new Date())
  await supabaseServer.rpc('increment_budget', {
    p_month: thisMonth,
    p_cost: COST_PER_ANALYSIS * count,
    p_count: count,
  })
}

export function getRemainingMonthly(monthlyCount: number): number {
  return Math.max(0, MONTHLY_LIMIT - monthlyCount)
}

export function getRemainingDaily(dailyCount: number): number {
  return Math.max(0, DAILY_LIMIT - dailyCount)
}
