// Deterministic writing-quality scorer. No LLM, no external deps.
// Used by the comprehensive analysis route to score each copy element
// after Claude returns, and by the recommendations route to aggregate
// writing-quality medians per quadrant. Numbers feed empirical constraints
// so spec generation respects winners' actual writing patterns
// (grade level, sentence length, active voice ratio, adverb/weasel density)
// instead of inventing foreign writing styles.

export interface WritingQualityScores {
  word_count: number
  sentence_count: number
  avg_sentence_length: number
  flesch_reading_ease: number           // 0-100, higher = simpler
  flesch_kincaid_grade: number          // school grade level
  active_voice_ratio: number            // 0-1
  passive_voice_count: number
  adverb_density: number                // -ly adverbs per 100 words
  weasel_word_count: number
  filler_word_density: number           // per 100 words
  cliche_count: number
  strong_verb_count: number
  hemingway_grade: 'good' | 'okay' | 'hard' | 'very_hard'
}

// Hedges and intensifiers that weaken claims. Hemingway flags these.
const WEASEL_WORDS = new Set<string>([
  'very', 'really', 'just', 'quite', 'rather', 'somewhat', 'fairly', 'pretty',
  'actually', 'basically', 'literally', 'simply', 'maybe', 'perhaps',
  'possibly', 'probably', 'kind', 'sort', 'a bit', 'a little',
])

// Common fillers that add no information. Counted toward filler_word_density.
const FILLER_WORDS = new Set<string>([
  'that', 'which', 'in order to', 'due to the fact', 'at this point',
  'with regard to', 'for the purpose of', 'in the event that',
])

// Curated cliché list. Not exhaustive — captures the most common ad-copy clichés.
const CLICHES = [
  'game changer', 'game-changer', 'cutting edge', 'cutting-edge', 'state of the art',
  'state-of-the-art', 'world class', 'world-class', 'best in class', 'best-in-class',
  'next level', 'next-level', 'one of a kind', 'one-of-a-kind', 'think outside the box',
  'level up', 'unlock your potential', 'transform your life', 'life-changing',
  'must have', 'must-have', 'no brainer', 'no-brainer', 'at the end of the day',
  'paradigm shift', 'low hanging fruit', 'low-hanging fruit', 'move the needle',
  'circle back', 'synergy', 'leverage', 'utilize', 'revolutionize',
]

// Verbs that carry strong specific action. Counted as positive signal.
const STRONG_VERBS = new Set<string>([
  'eliminate', 'eradicate', 'deliver', 'achieve', 'transform', 'prove', 'demonstrate',
  'unlock', 'expose', 'reveal', 'crush', 'shatter', 'master', 'conquer', 'discover',
  'guarantee', 'restore', 'unleash', 'ignite', 'forge', 'sharpen', 'accelerate',
  'dominate', 'protect', 'shield', 'cure', 'fix', 'solve', 'end', 'stop',
  'launch', 'build', 'create', 'design', 'craft', 'sculpt', 'engineer',
])

const VOWELS = 'aeiouy'

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (w.length === 0) return 0
  if (w.length <= 3) return 1
  // Strip trailing silent e
  let s = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
  s = s.replace(/^y/, '')
  const matches = s.match(/[aeiouy]{1,2}/g)
  return Math.max(matches?.length ?? 1, 1)
}

function tokenize(text: string): { sentences: string[]; words: string[]; wordList: string[] } {
  const trimmed = text.trim()
  if (!trimmed) return { sentences: [], words: [], wordList: [] }
  const sentences = trimmed.split(/[.!?]+(?:\s|$)/).map(s => s.trim()).filter(Boolean)
  // Words for counting (lowercased, alpha only)
  const words = trimmed.toLowerCase().match(/[a-z']+/g) ?? []
  return { sentences, words, wordList: words }
}

function countPassive(text: string): number {
  // Approximation: "(am|is|are|was|were|be|been|being) <verb>ed" with at least one space.
  // Acknowledged false positives (e.g. "are red") — this is a directional signal
  // for the scorer, not a linguistic classifier.
  const re = /\b(am|is|are|was|were|be|been|being)\s+\w+ed\b/gi
  return (text.match(re) ?? []).length
}

function countAdverbs(words: string[]): number {
  // -ly suffix heuristic with exclusions for common non-adverb -ly words.
  const exclude = new Set(['only', 'family', 'reply', 'apply', 'supply', 'rely', 'imply', 'fly', 'July', 'rally', 'jelly', 'belly', 'silly', 'really'])
  let count = 0
  for (const w of words) {
    if (w.endsWith('ly') && w.length > 4 && !exclude.has(w)) count++
  }
  return count
}

function countCliches(text: string): number {
  const lower = text.toLowerCase()
  let count = 0
  for (const c of CLICHES) {
    if (lower.includes(c)) count++
  }
  return count
}

function countWeasels(words: string[], fullText: string): number {
  let count = 0
  for (const w of words) {
    if (WEASEL_WORDS.has(w)) count++
  }
  // multi-word weasels
  const lower = fullText.toLowerCase()
  if (/\ba bit\b/.test(lower)) count++
  if (/\ba little\b/.test(lower)) count++
  if (/\bkind of\b/.test(lower)) count++
  if (/\bsort of\b/.test(lower)) count++
  return count
}

function countFillers(fullText: string): number {
  const lower = fullText.toLowerCase()
  let count = 0
  for (const f of FILLER_WORDS) {
    const re = new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
    count += (lower.match(re) ?? []).length
  }
  return count
}

function countStrongVerbs(words: string[]): number {
  let count = 0
  for (const w of words) {
    if (STRONG_VERBS.has(w)) count++
  }
  return count
}

function fleschReadingEase(words: number, sentences: number, syllables: number): number {
  if (words === 0 || sentences === 0) return 0
  const score = 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words)
  return Math.round(score * 10) / 10
}

function fleschKincaidGrade(words: number, sentences: number, syllables: number): number {
  if (words === 0 || sentences === 0) return 0
  const grade = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59
  return Math.round(grade * 10) / 10
}

function gradeBucket(fkGrade: number, avgSentence: number, passiveRatio: number, weaselDensity: number): WritingQualityScores['hemingway_grade'] {
  // Composite assessment loosely modeled on hemingwayapp grading:
  // good ≈ grade ≤ 6, short sentences, low passive, low weasels
  let demerits = 0
  if (fkGrade > 6) demerits++
  if (fkGrade > 9) demerits++
  if (fkGrade > 12) demerits++
  if (avgSentence > 14) demerits++
  if (avgSentence > 20) demerits++
  if (passiveRatio > 0.2) demerits++
  if (weaselDensity > 3) demerits++
  if (demerits === 0) return 'good'
  if (demerits <= 2) return 'okay'
  if (demerits <= 4) return 'hard'
  return 'very_hard'
}

export function scoreWritingQuality(text: string | null | undefined): WritingQualityScores | null {
  if (!text || !text.trim()) return null
  const { sentences, words } = tokenize(text)
  if (words.length === 0) return null

  const wordCount = words.length
  const sentenceCount = sentences.length === 0 ? 1 : sentences.length
  const syllables = words.reduce((s, w) => s + countSyllables(w), 0)
  const avgSentenceLength = wordCount / sentenceCount

  const passiveCount = countPassive(text)
  const activeRatio = sentenceCount > 0 ? Math.max(0, 1 - (passiveCount / sentenceCount)) : 1
  const adverbCount = countAdverbs(words)
  const adverbDensity = wordCount > 0 ? Math.round(((adverbCount / wordCount) * 100) * 10) / 10 : 0
  const weaselCount = countWeasels(words, text)
  const fillerCount = countFillers(text)
  const fillerDensity = wordCount > 0 ? Math.round(((fillerCount / wordCount) * 100) * 10) / 10 : 0
  const clicheCount = countCliches(text)
  const strongVerbCount = countStrongVerbs(words)

  const fre = fleschReadingEase(wordCount, sentenceCount, syllables)
  const fkg = fleschKincaidGrade(wordCount, sentenceCount, syllables)
  const weaselDensity = wordCount > 0 ? (weaselCount / wordCount) * 100 : 0

  return {
    word_count: wordCount,
    sentence_count: sentenceCount,
    avg_sentence_length: Math.round(avgSentenceLength * 10) / 10,
    flesch_reading_ease: fre,
    flesch_kincaid_grade: fkg,
    active_voice_ratio: Math.round(activeRatio * 100) / 100,
    passive_voice_count: passiveCount,
    adverb_density: adverbDensity,
    weasel_word_count: weaselCount,
    filler_word_density: fillerDensity,
    cliche_count: clicheCount,
    strong_verb_count: strongVerbCount,
    hemingway_grade: gradeBucket(fkg, avgSentenceLength, 1 - activeRatio, weaselDensity),
  }
}
