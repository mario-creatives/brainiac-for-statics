import { createClient } from '@supabase/supabase-js'

// Client-side: anon key only — safe to expose in browser
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
