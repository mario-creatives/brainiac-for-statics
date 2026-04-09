import { createClient } from '@supabase/supabase-js'

// Server-side only — service role bypasses RLS
// NEVER import this in client components or expose SUPABASE_SERVICE_ROLE_KEY client-side
export const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
