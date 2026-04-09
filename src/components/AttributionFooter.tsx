// Required on every page that shows TRIBE v2 output. Must not be conditionally hidden.
export function AttributionFooter() {
  return (
    <footer className="mt-8 pt-4 border-t border-gray-800 text-xs text-gray-500 space-y-2">
      <p>
        Brain activation analysis powered by{' '}
        <a
          href="https://ai.meta.com/research/publications/a-foundation-model-of-vision-audition-and-language-for-in-silico-neuroscience/"
          className="underline hover:text-gray-300 transition-colors"
          target="_blank"
          rel="noopener noreferrer"
        >
          Meta FAIR TRIBE v2
        </a>{' '}
        — Licensed under{' '}
        <a
          href="https://creativecommons.org/licenses/by-nc/4.0/"
          className="underline hover:text-gray-300 transition-colors"
          target="_blank"
          rel="noopener noreferrer"
        >
          CC-BY-NC-4.0
        </a>
        .
      </p>
      <p className="italic">
        This is an experimental brain response model. Results reflect predicted neural activation
        patterns, not guaranteed content performance. This tool operates under CC-BY-NC-4.0
        license for non-commercial research use only.
      </p>
    </footer>
  )
}
