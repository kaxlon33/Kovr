import { Link } from 'react-router-dom'
import {
  Crosshair,
  GitPullRequestArrow,
  History as HistoryIcon,
  Keyboard,
  ListChecks,
  Radar,
  ShieldCheck,
  Wrench,
} from 'lucide-react'
import { Card, KeyCap } from '@/components/ui/primitives'
import { SeverityBadge } from '@/components/findings/FindingBits'
import { PILLAR_KEYS, PILLAR_LABELS } from '@/api/types'
import { SEVERITY_BUCKETS } from '@/lib/format'

function SectionHeading({ icon: Icon, children }: { icon: typeof Radar; children: string }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-on-surface">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
        <Icon size={16} className="text-primary" />
      </span>
      {children}
    </h2>
  )
}

const SCAN_STEPS = [
  {
    title: 'Connect a repository',
    desc: 'Paste any public GitHub URL on the start screen and press Scan. The repository is copied for analysis — your original is never touched.',
  },
  {
    title: 'Watch the analysis',
    desc: 'Four analyzers run side by side: Security, API Design, Backend Logic and UI/UX. The progress page shows each one finishing in real time.',
  },
  {
    title: 'Read your report',
    desc: 'When the scan completes you land on the findings report with an overall security score and every issue listed by severity.',
  },
]

const FINDING_SECTIONS = [
  {
    title: 'Root cause & impact',
    desc: 'A plain-English explanation of what is wrong, why it matters, and how an attacker could reach it.',
  },
  {
    title: 'Suggested fix',
    desc: 'A before/after code diff you can review line by line. Nothing changes until you approve it.',
  },
  {
    title: 'Verified resolution',
    desc: 'After you approve a fix, KOVR re-checks the code automatically. A finding only counts as resolved when the re-check passes.',
  },
]

const BULK_STATUSES = [
  { label: 'Fixed', desc: 'The fix was applied and the re-check confirmed the issue is gone.' },
  { label: 'Auto-fix failed', desc: 'A fix was attempted but the re-check still found the issue. Open it to review what happened.' },
  { label: 'AI limit reached', desc: 'The daily AI allowance ran out. Nothing is broken — retry these findings once the limit resets.' },
  { label: 'Auto-fix not applicable', desc: 'Some issues, like leaked secrets, need action outside the code (for example rotating a key).' },
  { label: 'Codebase-wide change', desc: 'The issue spans many files. Use "Find and fix everywhere" to split it into individual fixable findings.' },
]

export function Docs() {
  return (
    <div className="animate-fade-up mx-auto w-full max-w-3xl space-y-10 p-6 md:p-8">
      <header className="border-b border-outline-variant pb-6">
        <h1 className="mb-2 text-4xl font-semibold tracking-tight text-on-surface">Guide</h1>
        <p className="text-sm text-on-surface-variant">
          Everything you need to scan a repository, understand the report, and fix findings with
          confidence.
        </p>
      </header>

      {/* Start a scan */}
      <section>
        <SectionHeading icon={Radar}>Start a scan</SectionHeading>
        <Card className="p-5">
          <ol className="space-y-4">
            {SCAN_STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 font-mono text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-on-surface">{step.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-on-surface-variant">{step.desc}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-outline-variant pt-4">
            {PILLAR_KEYS.map((key) => (
              <span
                key={key}
                className="rounded-md border border-outline-variant px-2.5 py-1 text-[11px] text-on-surface-variant"
              >
                {PILLAR_LABELS[key]}
              </span>
            ))}
          </div>
        </Card>
      </section>

      {/* Understanding the report */}
      <section>
        <SectionHeading icon={ListChecks}>Understanding your report</SectionHeading>
        <div className="space-y-3">
          <Card className="p-5">
            <p className="mb-2 text-sm font-medium text-on-surface">The security score</p>
            <p className="text-sm leading-relaxed text-on-surface-variant">
              The score (0–100) reflects how many issues remain open and how serious they are. Fixing
              findings raises it immediately — the number always shows the current state, so use it to
              track progress across runs.
            </p>
          </Card>
          <Card className="divide-y divide-outline-variant">
            {[
              { keys: SEVERITY_BUCKETS.highCritical, title: 'High & Critical', desc: 'Fix these first — real vulnerabilities with meaningful risk.' },
              { keys: SEVERITY_BUCKETS.warnings, title: 'Warnings', desc: 'Worth addressing; weaknesses that become risky in combination.' },
              { keys: SEVERITY_BUCKETS.info, title: 'Info', desc: 'Minor issues and hygiene improvements.' },
            ].map((bucket) => (
              <div key={bucket.title} className="px-4 py-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-on-surface">{bucket.title}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {bucket.keys.map((key) => (
                      <SeverityBadge key={key} severity={key} />
                    ))}
                  </span>
                </div>
                <p className="text-sm text-on-surface-variant">{bucket.desc}</p>
              </div>
            ))}
          </Card>
          <Card className="p-5">
            <p className="mb-2 text-sm font-medium text-on-surface">Filtering & search</p>
            <p className="text-sm leading-relaxed text-on-surface-variant">
              Click any severity card to show only those findings — click again to clear. The filter
              stays active while you open findings, so you always return to the same view. Use the
              search box to match titles, files and descriptions.
            </p>
          </Card>
        </div>
      </section>

      {/* Reviewing a finding */}
      <section>
        <SectionHeading icon={Crosshair}>Reviewing a finding</SectionHeading>
        <Card className="p-5">
          <div className="space-y-4">
            {FINDING_SECTIONS.map((item) => (
              <div key={item.title}>
                <p className="text-sm font-medium text-on-surface">{item.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-on-surface-variant">{item.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-col gap-2 border-t border-outline-variant pt-4 text-sm text-on-surface-variant sm:flex-row sm:items-center sm:justify-between">
            <span>Not happy with a suggestion? Reject it, or press "Try automatic fix again".</span>
            <Link to="/connect" className="shrink-0 font-medium text-primary hover:underline">
              Start a scan →
            </Link>
          </div>
        </Card>
      </section>

      {/* Fixing findings */}
      <section>
        <SectionHeading icon={Wrench}>Fixing many findings at once</SectionHeading>
        <Card className="p-5 text-sm leading-relaxed text-on-surface-variant">
          <p>
            Select findings with the checkboxes or the <em>Select High/Critical</em> style buttons,
            then press <span className="font-medium text-on-surface">Bulk approve</span>. KOVR works
            through the list one by one — investigating, patching and verifying each — while you
            watch the live status on every row. Need a moment? Press{' '}
            <span className="font-medium text-on-surface">Pause</span> and resume whenever you're
            ready; the finding in progress always finishes first.
          </p>
          <div className="mt-4 space-y-2.5 border-t border-outline-variant pt-4">
            {BULK_STATUSES.map((status) => (
              <p key={status.label} className="flex flex-wrap items-baseline gap-2">
                <span className="shrink-0 rounded border border-outline-variant bg-surface-container-lowest px-2 py-0.5 text-xs font-medium text-on-surface">
                  {status.label}
                </span>
                <span>{status.desc}</span>
              </p>
            ))}
          </div>
        </Card>
      </section>

      {/* Sending fixes to GitHub */}
      <section>
        <SectionHeading icon={GitPullRequestArrow}>Sending fixes to GitHub</SectionHeading>
        <div className="space-y-3">
          <Card className="p-5">
            <p className="mb-2 text-sm font-medium text-on-surface">Connect your GitHub account</p>
            <p className="text-sm leading-relaxed text-on-surface-variant">
              In <Link to="/settings" className="text-primary hover:underline">Settings → GitHub</Link>,
              connect your own account once (look for the GitHub button). Pull requests are always
              opened under your account, only on repositories you can write to.
            </p>
          </Card>
          <Card className="p-5">
            <p className="mb-4 text-sm font-medium text-on-surface">How it works, step by step</p>
            <ol className="space-y-4">
              {[
                {
                  title: 'Connect GitHub',
                  desc: 'Settings → GitHub → Connect GitHub. GitHub asks you to authorize KOVR once — after that, KOVR can push branches and open pull requests for you.',
                },
                {
                  title: 'Approve fixes as usual',
                  desc: 'Every fix you approve that passes verification is automatically saved as a commit on a private branch of your repository (kovr/fix-…). Nothing is pushed yet.',
                },
                {
                  title: 'Press "Open Pull Request"',
                  desc: 'When you\'re done, the button appears on the findings page and the summary. KOVR first double-checks the changed code for accidentally included secrets, then pushes the branch and opens ONE pull request listing every fix.',
                },
                {
                  title: 'Review and merge on GitHub',
                  desc: 'Open the pull request (the "View Pull Request" button links to it), look over the changes like any code review, and merge it when you\'re happy. That\'s it — your repository is fixed.',
                },
              ].map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 font-mono text-xs font-semibold text-primary">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-on-surface">{step.title}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-on-surface-variant">{step.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </section>

      {/* History */}
      <section>
        <SectionHeading icon={HistoryIcon}>Your scan history</SectionHeading>
        <Card className="p-5 text-sm leading-relaxed text-on-surface-variant">
          Every scan you run is listed under History with its score and open-issue count. Open one to
          jump straight back into its report — the results are re-read fresh, so you always see the
          latest state. Remove individual entries with the × button, or clear everything at once.
        </Card>
      </section>

      {/* Shortcuts */}
      <section>
        <SectionHeading icon={Keyboard}>Keyboard shortcuts</SectionHeading>
        <Card className="divide-y divide-outline-variant">
          {[
            { keys: ['Ctrl', 'K'], text: 'Command palette — jump to a finding, a past scan, or refresh results.' },
            { keys: ['G', 'F'], text: 'Jump to findings. G then C, S, Y, T or H reach the other pages.' },
            { keys: ['J'], text: 'Move down the findings list; K moves back up.' },
            { keys: ['X'], text: 'Select the highlighted finding for a bulk run.' },
            { keys: ['Enter'], text: 'Open the highlighted finding.' },
            { keys: ['?'], text: 'Full shortcut reference.' },
          ].map((row) => (
            <div key={row.text} className="flex items-start gap-4 px-4 py-3">
              <span className="flex w-20 shrink-0 gap-1">
                {row.keys.map((key) => (
                  <KeyCap key={key}>{key}</KeyCap>
                ))}
              </span>
              <p className="text-sm text-on-surface-variant">{row.text}</p>
            </div>
          ))}
        </Card>
      </section>

      <p className="flex items-center justify-center gap-1.5 pb-4 text-center text-xs text-on-surface-variant">
        <ShieldCheck size={13} aria-hidden />
        Every fix is applied to a copy and verified before it counts — your original repository is
        never modified.
      </p>
    </div>
  )
}
