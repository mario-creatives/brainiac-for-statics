export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between border-b border-gray-800/50">
        <span className="text-indigo-400 font-bold text-lg">Brainiac</span>
        <div className="flex items-center gap-4 text-sm">
          <a href="/auth/login" className="text-gray-400 hover:text-white transition-colors">
            Log in
          </a>
          <a
            href="/auth/signup"
            className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors"
          >
            Get started free
          </a>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
        <p className="text-xs text-indigo-400 font-medium tracking-wider uppercase mb-4">
          Experimental · Non-commercial · CC-BY-NC-4.0
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold text-white max-w-2xl leading-tight mb-5">
          See how your creatives register in the brain
        </h1>
        <p className="text-gray-400 text-lg max-w-xl mb-10">
          Upload a thumbnail or connect your Meta Ads account. Brainiac runs Meta FAIR's TRIBE v2
          brain encoding model and shows which neural regions activate in response to your creative.
        </p>

        <div className="flex gap-4 justify-center flex-wrap">
          <a
            href="/auth/signup"
            className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium
                       hover:bg-indigo-500 transition-colors"
          >
            Analyze a creative →
          </a>
          <a
            href="/legal/terms"
            className="px-6 py-3 border border-gray-700 text-gray-400 rounded-lg
                       hover:border-gray-500 hover:text-white transition-colors text-sm"
          >
            Terms & license
          </a>
        </div>

        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl w-full text-left">
          {[
            {
              icon: '🧠',
              title: 'Brain encoding model',
              body: 'Powered by Meta FAIR TRIBE v2 — a foundation model trained on fMRI data that predicts neural responses to visual stimuli.',
            },
            {
              icon: '📊',
              title: 'ROI activation breakdown',
              body: 'See which brain regions activate: face detection, text processing, spatial attention, scene recognition, and more.',
            },
            {
              icon: '🔒',
              title: 'Free & private',
              body: 'No credit card. No performance claims. Your individual creatives are never shared. Anonymized aggregate signals power future research.',
            },
          ].map(card => (
            <div
              key={card.title}
              className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-2"
            >
              <p className="text-2xl">{card.icon}</p>
              <p className="font-medium text-white text-sm">{card.title}</p>
              <p className="text-gray-500 text-sm leading-relaxed">{card.body}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="px-6 py-6 border-t border-gray-800/50 text-xs text-gray-600 flex flex-wrap gap-4 justify-between">
        <p>
          Brain activation analysis powered by{' '}
          <a
            href="https://ai.meta.com/research/publications/a-foundation-model-of-vision-audition-and-language-for-in-silico-neuroscience/"
            className="underline hover:text-gray-400"
            target="_blank"
            rel="noopener noreferrer"
          >
            Meta FAIR TRIBE v2
          </a>{' '}
          — Licensed under{' '}
          <a
            href="https://creativecommons.org/licenses/by-nc/4.0/"
            className="underline hover:text-gray-400"
            target="_blank"
            rel="noopener noreferrer"
          >
            CC-BY-NC-4.0
          </a>
          . This tool is experimental and makes no performance guarantees.
        </p>
        <p>
          <a href="/legal/terms" className="underline hover:text-gray-400">Terms</a>
          {' · '}
          <a href="/legal/privacy" className="underline hover:text-gray-400">Privacy</a>
        </p>
      </footer>
    </div>
  )
}
