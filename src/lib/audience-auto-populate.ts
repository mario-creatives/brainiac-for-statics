import { supabaseServer } from '@/lib/supabase-server'

export interface InferenceForAutoPopulate {
  inferred_tam_label?: string
  inferred_persona?: string
  inferred_micro_persona?: string
  inferred_concept?: string
  inferred_angle?: string
  inferred_age_range?: '18–24' | '25–34' | '35–44' | '45–54' | '55–64' | '65+'
}

async function findOrCreateTam(productId: string, label: string): Promise<string | null> {
  const trimmed = label.trim()
  if (!trimmed) return null
  const { data: existing } = await supabaseServer
    .from('product_tams')
    .select('id')
    .eq('product_id', productId)
    .ilike('label', trimmed)
    .maybeSingle()
  if (existing) return (existing as { id: string }).id
  const { data: created, error } = await supabaseServer
    .from('product_tams')
    .insert({ product_id: productId, label: trimmed })
    .select('id')
    .single()
  if (error) return null
  return (created as { id: string }).id
}

async function findOrCreatePersona(tamId: string, label: string): Promise<string | null> {
  const trimmed = label.trim()
  if (!trimmed) return null
  const { data: existing } = await supabaseServer
    .from('product_personas')
    .select('id')
    .eq('tam_id', tamId)
    .ilike('label', trimmed)
    .maybeSingle()
  if (existing) return (existing as { id: string }).id
  const { data: created, error } = await supabaseServer
    .from('product_personas')
    .insert({ tam_id: tamId, label: trimmed })
    .select('id')
    .single()
  if (error) return null
  return (created as { id: string }).id
}

async function findOrCreateMicroPersona(personaId: string, label: string): Promise<string | null> {
  const trimmed = label.trim()
  if (!trimmed) return null
  const { data: existing } = await supabaseServer
    .from('product_micro_personas')
    .select('id')
    .eq('persona_id', personaId)
    .ilike('label', trimmed)
    .maybeSingle()
  if (existing) return (existing as { id: string }).id
  const { data: created, error } = await supabaseServer
    .from('product_micro_personas')
    .insert({ persona_id: personaId, label: trimmed })
    .select('id')
    .single()
  if (error) return null
  return (created as { id: string }).id
}

export async function findOrCreateConcept(productId: string, label: string): Promise<string | null> {
  const trimmed = label.trim()
  if (!trimmed) return null
  const { data: existing } = await supabaseServer
    .from('product_concepts')
    .select('id')
    .eq('product_id', productId)
    .ilike('label', trimmed)
    .maybeSingle()
  if (existing) return (existing as { id: string }).id
  const { data: created, error } = await supabaseServer
    .from('product_concepts')
    .insert({ product_id: productId, label: trimmed })
    .select('id')
    .single()
  if (error) return null
  return (created as { id: string }).id
}

export async function findOrCreateAngle(productId: string, label: string): Promise<string | null> {
  const trimmed = label.trim()
  if (!trimmed) return null
  const { data: existing } = await supabaseServer
    .from('product_angles')
    .select('id')
    .eq('product_id', productId)
    .ilike('label', trimmed)
    .maybeSingle()
  if (existing) return (existing as { id: string }).id
  const { data: created, error } = await supabaseServer
    .from('product_angles')
    .insert({ product_id: productId, label: trimmed })
    .select('id')
    .single()
  if (error) return null
  return (created as { id: string }).id
}

export async function autoPopulateFromInference(
  analysisId: string,
  productId: string,
  inf: InferenceForAutoPopulate,
): Promise<void> {
  const update: Record<string, unknown> = {}

  if (inf.inferred_tam_label) {
    const tamId = await findOrCreateTam(productId, inf.inferred_tam_label)
    if (tamId) {
      update.tam_id = tamId
      if (inf.inferred_persona) {
        const personaId = await findOrCreatePersona(tamId, inf.inferred_persona)
        if (personaId) {
          update.persona_id = personaId
          if (inf.inferred_micro_persona) {
            const microId = await findOrCreateMicroPersona(personaId, inf.inferred_micro_persona)
            if (microId) update.micro_persona_id = microId
          }
        }
      }
    }
  }

  // Conditional fills: never overwrite user input.
  const { data: existing } = await supabaseServer
    .from('analyses')
    .select('age_range, stated_concept, stated_angle')
    .eq('id', analysisId)
    .maybeSingle()
  const row = existing as { age_range: string | null; stated_concept: string | null; stated_angle: string | null } | null

  // Age range always refreshed from fresh inference — it's a fixed enum bucket, not user text.
  if (inf.inferred_age_range)                          update.age_range      = inf.inferred_age_range
  if (!row?.stated_concept && inf.inferred_concept)    update.stated_concept = inf.inferred_concept
  if (!row?.stated_angle && inf.inferred_angle)        update.stated_angle   = inf.inferred_angle

  // Find-or-create concept/angle FKs against the effective text (user edits
  // win over fresh inference). Independent of TAM/persona chain.
  const effectiveConcept = row?.stated_concept ?? inf.inferred_concept ?? null
  const effectiveAngle   = row?.stated_angle   ?? inf.inferred_angle   ?? null
  if (effectiveConcept) {
    const conceptId = await findOrCreateConcept(productId, effectiveConcept)
    if (conceptId) update.concept_id = conceptId
  }
  if (effectiveAngle) {
    const angleId = await findOrCreateAngle(productId, effectiveAngle)
    if (angleId) update.angle_id = angleId
  }

  if (Object.keys(update).length === 0) return

  await supabaseServer.from('analyses').update(update).eq('id', analysisId)
}
