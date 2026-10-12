import Link from 'next/link';
import AgentAvatar from './agent-avatar';
import LandingDemo from './landing-demo';

export const metadata = {
  title: 'Form Agent — fill Google Forms by chatting',
  description:
    'A stealth browser agent that fills Google Forms for you: chat your answers, let AI handle quizzes, and send files straight from your phone.',
};

const FEATURES = [
  {
    icon: 'browser',
    title: 'Live stealth browser',
    body: 'Runs in Camoufox, an anti-detection Firefox. Watch every click in the live browser view, and step in whenever you like.',
  },
  {
    icon: 'chat',
    title: 'Answer in chat',
    body: 'The agent reads each question and asks you in plain chat — options become tappable choices, text fields take your reply.',
  },
  {
    icon: 'spark',
    title: 'AI mode',
    body: 'Let a model answer multiple-choice and short questions for you — locally with Ollama, or with a Groq, Gemini, OpenRouter or DeepSeek key.',
  },
  {
    icon: 'phone',
    title: 'Files from your phone',
    body: 'Hit a file-upload question and a QR code appears in chat. Scan, pick a photo or PDF, and it lands in the form — no app to install.',
  },
  {
    icon: 'pages',
    title: 'Multi-page forms',
    body: 'Text, dropdowns, radio buttons, checkboxes and uploads across every page, with Next and Submit handled for you.',
  },
  {
    icon: 'lock',
    title: 'Private by design',
    body: 'Pairing codes expire in minutes and work once. Uploaded files are deleted when the session ends, and keys never reach your browser.',
  },
];

const STEPS = [
  {
    title: 'Paste a form link',
    body: 'Drop any docs.google.com/forms link into the chat and pick Guided or AI mode.',
  },
  {
    title: 'The agent scans it',
    body: 'It opens the form in the live browser and lists every question it finds, page by page.',
  },
  {
    title: 'Answer or scan',
    body: 'Reply in chat, or scan the QR to send a document from your phone for upload questions.',
  },
  {
    title: 'Review and submit',
    body: 'Watch the answers go in, check the form in the live view, and the agent submits it.',
  },
];

// 24px line icons, drawn in the accent colour via currentColor.
const ICON_PATHS = {
  browser: 'M3 5h18v14H3z M3 9h18 M6.5 7h.01 M9 7h.01',
  chat: 'M4 5h16v11H9l-5 4z M8 9.5h8 M8 12.5h5',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  phone: 'M7 2.5h10v19H7z M10.5 18.5h3',
  pages: 'M8 3h10v14H8z M5 7v14h10 M11 8h4 M11 11h4',
  lock: 'M6 11h12v10H6z M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11 M12 15v2',
};

function FeatureIcon({ name }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

const REPO_URL = 'https://github.com/Harshk133/como-agents';

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function SectionLabel({ children }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#8B5CF6]">{children}</p>
  );
}

function GetStarted({ className = '' }) {
  return (
    <Link
      href="/agent"
      className={`group inline-flex items-center gap-2 rounded-xl bg-[#7C3AED] px-5 py-3 text-sm font-medium text-white shadow-lg shadow-[#7C3AED]/25 transition-colors hover:bg-[#8B5CF6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8B5CF6] ${className}`}
    >
      Get started
      <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
        →
      </span>
    </Link>
  );
}

export default function Landing() {
  return (
    <div className="landing-bg h-full overflow-y-auto overflow-x-hidden scroll-smooth">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-[#292929]/70 bg-[#0B0B0B]/95 backdrop-blur-md">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <AgentAvatar state="idle" size={28} compact aria-label="Form Agent" />
            <span className="text-sm font-semibold tracking-tight">Form Agent</span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <a href="#features" className="hidden rounded-lg px-3 py-1.5 text-xs text-[#A1A1A1] transition-colors hover:text-[#F5F5F5] sm:block">
              Features
            </a>
            <a href="#how" className="hidden rounded-lg px-3 py-1.5 text-xs text-[#A1A1A1] transition-colors hover:text-[#F5F5F5] sm:block">
              How it works
            </a>
            <a href="#phone" className="hidden rounded-lg px-3 py-1.5 text-xs text-[#A1A1A1] transition-colors hover:text-[#F5F5F5] sm:block">
              Phone uploads
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View the source on GitHub"
              title="View on GitHub"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#292929] text-[#A1A1A1] transition-colors hover:border-[#3a3a3a] hover:bg-[#151515] hover:text-[#F5F5F5]"
            >
              <GitHubIcon />
            </a>
            <Link
              href="/agent"
              className="ml-1 rounded-lg border border-[#7C3AED]/60 bg-[#7C3AED]/10 px-3 py-1.5 text-xs font-medium text-[#F5F5F5] transition-colors hover:bg-[#7C3AED]/25"
            >
              Get started
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-16 pb-20 sm:px-6 md:pt-24 lg:grid-cols-[1.1fr_1fr] lg:gap-10">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#292929] bg-[#151515] px-3 py-1 text-[11px] text-[#A1A1A1]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Powered by Camofox · stealth browser automation
            </span>
            <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              Fill Google Forms
              <br />
              <span className="bg-gradient-to-r from-[#B7A4F2] via-[#8B5CF6] to-[#7C3AED] bg-clip-text text-transparent">
                just by chatting.
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-[#A1A1A1]">
              Paste a form link and your agent opens it in a real browser, asks you each question
              in chat, lets AI handle the quiz, and pulls documents straight from your phone.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <GetStarted />
              <a
                href="#how"
                className="rounded-xl border border-[#292929] px-5 py-3 text-sm text-[#A1A1A1] transition-colors hover:border-[#3a3a3a] hover:text-[#F5F5F5]"
              >
                See how it works
              </a>
            </div>
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-[#292929] pt-6">
              {[
                ['0', 'apps to install'],
                ['5 min', 'QR pairing window'],
                ['10 MB', 'per uploaded file'],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt className="sr-only">{label}</dt>
                  <dd className="text-xl font-semibold tracking-tight">{value}</dd>
                  <dd className="mt-0.5 text-[11px] text-[#666666]">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex justify-center lg:justify-end">
            <LandingDemo />
          </div>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-16 border-t border-[#292929]/70 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionLabel>Features</SectionLabel>
            <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
              Everything a form needs, handled in one chat.
            </h2>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <article
                  key={f.title}
                  className="group relative overflow-hidden rounded-2xl border border-[#292929] bg-[#111111] p-6 transition-colors hover:border-[#7C3AED]/50"
                >
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-[#7C3AED]/0 blur-2xl transition-colors duration-500 group-hover:bg-[#7C3AED]/20"
                  />
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#292929] bg-[#151515] text-lg text-[#8B5CF6]">
                    <FeatureIcon name={f.icon} />
                  </span>
                  <h3 className="mt-5 text-base font-semibold tracking-tight">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#A1A1A1]">{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-16 border-t border-[#292929]/70 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionLabel>How it works</SectionLabel>
            <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
              From link to submitted in four steps.
            </h2>
            <ol className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative rounded-2xl border border-[#292929] bg-[#111111] p-6">
                  <span className="font-mono text-xs text-[#8B5CF6]">0{i + 1}</span>
                  <h3 className="mt-3 text-base font-semibold tracking-tight">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#A1A1A1]">{s.body}</p>
                  {i < STEPS.length - 1 && (
                    <span
                      aria-hidden
                      className="absolute top-1/2 -right-3 z-10 hidden h-px w-6 bg-gradient-to-r from-[#7C3AED]/70 to-transparent lg:block"
                    />
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Phone bridge spotlight */}
        <section id="phone" className="scroll-mt-16 border-t border-[#292929]/70 py-20">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
            <div>
              <SectionLabel>Phone uploads</SectionLabel>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                Your documents are on your phone. Now so is the upload button.
              </h2>
              <p className="mt-5 text-base leading-relaxed text-[#A1A1A1]">
                When the form asks for a photo, signature, marksheet or certificate, the agent shows a
                QR code for that exact question. Scan it, tap <em>Pair</em>, choose the file, and it is
                attached for you.
              </p>
              <ul className="mt-6 space-y-2.5 text-sm text-[#A1A1A1]">
                {[
                  'PDF, JPEG, PNG and WebP — checked by content, not just the name',
                  'Single-use pairing that expires after 5 minutes',
                  'Files stay private and are removed when the session ends',
                ].map((t) => (
                  <li key={t} className="flex gap-2.5">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#8B5CF6]" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-center gap-6 sm:gap-10">
              {/* QR card */}
              <div className="rounded-2xl border border-[#292929] bg-[#111111] p-5 text-center">
                <div className="grid h-32 w-32 grid-cols-7 gap-1 rounded-lg bg-[#F5F5F5] p-2.5" aria-hidden>
                  {Array.from({ length: 49 }, (_, i) => {
                    const r = Math.floor(i / 7);
                    const c = i % 7;
                    const finder = (r < 2 && c < 2) || (r < 2 && c > 4) || (r > 4 && c < 2);
                    const on = finder || (r * 3 + c * 5 + r * c) % 3 === 0;
                    return <span key={i} className={on ? 'rounded-[2px] bg-[#0B0B0B]' : ''} />;
                  })}
                </div>
                <p className="mt-3 text-[11px] text-[#666666]">Scan to send a file</p>
              </div>
              <span aria-hidden className="text-2xl text-[#7C3AED]">⇢</span>
              {/* Phone */}
              <div className="w-36 rounded-[1.75rem] border border-[#292929] bg-[#151515] p-2 shadow-2xl shadow-[#7C3AED]/10">
                <div className="rounded-[1.35rem] bg-[#0B0B0B] px-3 pt-5 pb-4">
                  <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#292929]" />
                  <p className="text-[10px] font-medium text-[#F5F5F5]">Upload your marksheet</p>
                  <div className="mt-3 rounded-lg border border-dashed border-[#3a3a3a] px-2 py-4 text-center text-[9px] text-[#666666]">
                    marksheet.pdf
                    <br />
                    1.2 MB
                  </div>
                  <div className="mt-3 rounded-lg bg-[#7C3AED] py-1.5 text-center text-[10px] font-medium text-white">
                    Send
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-[#292929]/70 py-24">
          <div className="mx-auto flex max-w-3xl flex-col items-center px-4 text-center sm:px-6">
            <AgentAvatar state="happy" size={112} aria-label="Happy robot" />
            <h2 className="mt-10 text-3xl font-semibold tracking-tight sm:text-4xl">
              Ready to fill your first form?
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-[#A1A1A1]">
              Paste a Google Form link and let the agent take it from there.
            </p>
            <GetStarted className="mt-8" />
          </div>
        </section>
      </main>

      <footer className="border-t border-[#292929]/70">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-[11px] text-[#666666] sm:flex-row sm:px-6">
          <p>Form Agent · built on Camofox Browser</p>
          <p>You stay in control — review every form in the live browser.</p>
        </div>
      </footer>
    </div>
  );
}
