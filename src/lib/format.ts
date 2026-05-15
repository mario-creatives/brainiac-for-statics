// Display helpers — keep formatting decisions in one place so every surface
// reads the same way.

// A7 from brutal-audit-v2: a letter grade alone is lossy (a 4.1 and a 5.9
// both render as "C"). Show the numeric score alongside the letter wherever
// the grade appears.
export function formatGrade(grade: string | null | undefined, score: number | null | undefined): string {
  if (!grade) return '—'
  if (score == null || isNaN(score)) return grade
  return `${grade} (${score.toFixed(1)})`
}
