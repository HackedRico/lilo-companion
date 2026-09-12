import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { Aim } from '../../shared/types.ts'
import {
  PROTOCOL_LABEL,
  type ConnectionResult,
  type SettingsPatch,
  type SettingsView
} from '../../shared/settings.ts'
import { ROLE_LABEL, type Profile, type RoleFamily } from '../../shared/types.ts'
import { TIERS, TIER_LABEL, TIER_NOTE, type ChromeSetup, type ChromeStatus } from '../../shared/leetcode.ts'
import { api } from '../api.ts'
import { Action, Field, Group, KeyRow, TextInput } from './fields.tsx'
import { ModelField } from './ModelField.tsx'

type Tab = 'profile' | 'model' | 'leetcode' | 'advanced'

const TABS: { value: Tab; label: string; icon: ReactElement }[] = [
  {
    value: 'profile',
    label: 'Profile',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="5.6" r="2.9" />
        <path d="M2.6 14c.6-2.8 2.7-4.3 5.4-4.3s4.8 1.5 5.4 4.3" />
      </svg>
    )
  },
  {
    value: 'model',
    label: 'Model',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden>
        <rect x="2.4" y="2.4" width="11.2" height="11.2" rx="3" />
        <path d="M6.2 6.2h3.6v3.6H6.2z" />
      </svg>
    )
  },
  {
    value: 'leetcode',
    label: 'LeetCode',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden>
        <path d="M6 3.5 2.8 8 6 12.5" />
        <path d="M10 3.5 13.2 8 10 12.5" />
      </svg>
    )
  },
  {
    value: 'advanced',
    label: 'Advanced',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden>
        <circle cx="5" cy="4.5" r="2" />
        <path d="M7 4.5h6.5M2.5 4.5h.5" />
        <circle cx="11" cy="11.5" r="2" />
        <path d="M2.5 11.5H9M13 11.5h.5" />
      </svg>
    )
  }
]

/** Reopening should land where you were, which needs no round trip to ask. */
function lastTab(): Tab {
  try {
    const saved = localStorage.getItem('prefs-tab')
    return saved === 'model' || saved === 'leetcode' || saved === 'advanced' ? saved : 'profile'
  } catch {
    return 'profile'
  }
}

export function Prefs(): ReactElement {
  const [tab, setTab] = useState<Tab>(lastTab)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [storage, setStorage] = useState('')
  const [saved, setSaved] = useState(false)
  const fade = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    void api.readSettings().then(setSettings)
    void api.readProfile().then(setProfile)
    void api.storagePath().then(setStorage)
  }, [])

  const pick = (next: Tab): void => {
    setTab(next)
    try {
      localStorage.setItem('prefs-tab', next)
    } catch {
      // Forgetting which tab you were on is not worth an error.
    }
  }

  const flash = (): void => {
    setSaved(true)
    clearTimeout(fade.current)
    fade.current = setTimeout(() => setSaved(false), 1300)
  }

  const saveSettings = (patch: SettingsPatch): void => {
    void api.writeSettings(patch).then((next) => {
      setSettings(next)
      flash()
    })
  }

  const saveProfile = (patch: Partial<Profile>): void => {
    void api.writeProfile(patch).then((next) => {
      setProfile(next)
      flash()
    })
  }

  return (
    <div className="prefs">
      <nav className="rail" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="rail-title">Lilo</div>
        <div className="flex flex-col gap-0.5">
          {TABS.map((one) => (
            <button
              key={one.value}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              data-on={tab === one.value}
              onClick={() => pick(one.value)}
            >
              {one.icon}
              {one.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="pane">
        <div className="pane-top" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        <div className="pane-body scroller">
          <div className="pane-inner">
            {!settings || !profile ? (
              <p className="text-[12px]" style={{ color: 'var(--dim)' }}>
                Reading what you had…
              </p>
            ) : tab === 'profile' ? (
              <ProfileTab profile={profile} save={saveProfile} />
            ) : tab === 'leetcode' ? (
              <LeetCodeTab profile={profile} save={saveProfile} />
            ) : tab === 'model' ? (
              <ModelTab settings={settings} save={saveSettings} />
            ) : (
              <AdvancedTab
                storage={storage}
                settings={settings}
                onForget={() => {
                  void api.forgetSettings().then(setSettings)
                  void api.readProfile().then(setProfile)
                }}
              />
            )}
          </div>
        </div>

        <footer className="pane-foot" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <p className="m-0 text-[12px] leading-[1.6]" style={{ color: 'var(--dim)' }}>
            Lilo companion
          </p>
          <span
            className="shrink-0 text-[12px] font-medium transition-opacity duration-300"
            style={{ color: 'var(--dim)', opacity: saved ? 1 : 0 }}
          >
            Saved
          </span>
        </footer>
      </div>
    </div>
  )
}

function TabHeader({ title, description }: { title: string; description: string }): ReactElement {
  return (
    <div className="tab-header">
      <h1 className="tab-title">{title}</h1>
      <p className="tab-desc">{description}</p>
    </div>
  )
}

function ProfileTab({
  profile,
  save
}: {
  profile: Profile
  save: (patch: Partial<Profile>) => void
}): ReactElement {
  const leaning = Object.entries(profile.roleAffinity)
    .filter(([, votes]) => votes > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([role]) => ROLE_LABEL[role as RoleFamily])

  return (
    <>
      <TabHeader
        title="Profile"
        description="What the companion tailors itself to: which engineering postings it shows you, and who the work comes from."
      />
      <div className="fields">
        <Field label="Studying">
          <TextInput value={profile.major} placeholder="Computer science" onCommit={(major) => save({ major })} />
        </Field>
        <Field label="Year">
          <TextInput value={profile.year} placeholder="Junior" onCommit={(year) => save({ year })} />
        </Field>
        <Field
          wide
          label="Aiming at"
          hint={
            leaning.length > 0
              ? `You keep saying ${leaning.join(' and ')} sounds like you, which nudges the same way.`
              : 'Say it however you like. What it matches in real postings is shown beside it.'
          }
        >
          <Aims profile={profile} save={save} />
        </Field>
      </div>

      <Group title="Heard so far" note="The recap will not offer these back to you as gaps.">
        {profile.heardTerms.length === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--dim)' }}>
            Nothing yet. This fills in as concepts are read back to you.
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {profile.heardTerms.map((term) => (
                <span key={term} className="tag" style={{ color: 'var(--dim)' }}>
                  {term}
                </span>
              ))}
            </div>
            <Action onClick={() => save({ heardTerms: [] })}>Clear these</Action>
          </>
        )}
      </Group>
    </>
  )
}

/**
 * In their own words, then answered by the data. Onboarding seeds this with the
 * track it heard, so nothing is filtered on that is not shown here. Showing what
 * each phrase landed on keeps the app from quietly filtering on something else,
 * and says plainly when there is nothing behind it.
 */
function Aims({
  profile,
  save
}: {
  profile: Profile
  save: (patch: Partial<Profile>) => void
}): ReactElement {
  const [aims, setAims] = useState<Aim[]>([])
  const [draft, setDraft] = useState('')
  const key = profile.aims.join('|')

  useEffect(() => {
    void api.resolveAims(profile.aims).then(setAims)
  }, [key])

  const commit = (next: string[]): void => save({ aims: next })

  return (
    <>
      {aims.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {aims.map((aim) => (
            <span key={aim.said} className="tag">
              {aim.said}
              <span className="meta" style={aim.family ? undefined : { color: 'var(--live)' }}>
                {aim.family ? ROLE_LABEL[aim.family] : 'nothing like it'}
              </span>
              <button
                aria-label={`Remove ${aim.said}`}
                onClick={() => commit(profile.aims.filter((one) => one !== aim.said))}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className="input"
        value={draft}
        placeholder="Backend, mobile, infrastructure…"
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const value = draft.trim()
          if (value && !profile.aims.includes(value)) commit([...profile.aims, value])
          setDraft('')
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          event.currentTarget.blur()
        }}
      />
    </>
  )
}

function ModelTab({
  settings,
  save
}: {
  settings: SettingsView
  save: (patch: SettingsPatch) => void
}): ReactElement {
  const [tested, setTested] = useState<ConnectionResult | null>(null)
  const [testing, setTesting] = useState(false)

  const change = (patch: SettingsPatch): void => {
    setTested(null)
    save(patch)
  }

  return (
    <>
      <TabHeader
        title="Model"
        description="Any model you can reach: a hosted service, or one running on this machine. How the endpoint speaks is worked out from its address."
      />
      <div className="fields">
        <Field
          wide
          label="Endpoint URL"
          badge={settings.baseUrl ? PROTOCOL_LABEL[settings.protocol] : undefined}
          hint={
            settings.local
              ? 'On this machine, so no key is wanted.'
              : 'Featherless, OpenRouter, Groq, Ollama, LM Studio, vLLM, or api.anthropic.com.'
          }
        >
          {/* Keyed on the value, so an address tidied by main shows tidied. */}
          <TextInput
            key={settings.baseUrl}
            mono
            value={settings.baseUrl}
            placeholder="https://host/v1"
            onCommit={(baseUrl) => change({ baseUrl })}
          />
        </Field>
        <Field wide label="API key">
          <KeyRow
            state={settings.apiKey}
            envName="LLM_API_KEY"
            absent={settings.local ? 'Not needed' : 'Not set'}
            onSet={(apiKey) => change({ apiKey })}
          />
        </Field>
        <Field label="Quick model" hint="Reads the lecture and answers questions.">
          <ModelField value={settings.modelFast} onPick={(modelFast) => change({ modelFast })} />
        </Field>
        <Field label="Careful model" hint="Coaches on LeetCode and inspects your code.">
          <ModelField value={settings.modelStrong} onPick={(modelStrong) => change({ modelStrong })} />
        </Field>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <Action
          disabled={testing}
          onClick={() => {
            setTesting(true)
            setTested(null)
            void api
              .testConnection()
              .then(setTested)
              .finally(() => setTesting(false))
          }}
        >
          {testing ? 'Asking…' : 'Test it'}
        </Action>
        {tested && (
          <span className="verdict" style={{ color: tested.ok ? 'var(--dim)' : 'var(--live)' }}>
            {tested.ok ? `Answered in ${(tested.ms / 1000).toFixed(1)}s` : tested.detail}
          </span>
        )}
      </div>
    </>
  )
}

/**
 * A ceiling on the ladder, not a personality, and the one-time step that lets
 * the app see the page. The status is polled, because the connection lives in
 * main and Chrome can drop it at any moment.
 */
function LeetCodeTab({
  profile,
  save
}: {
  profile: Profile
  save: (patch: Partial<Profile>) => void
}): ReactElement {
  const [status, setStatus] = useState<ChromeStatus | null>(null)
  const [setup, setSetup] = useState<ChromeSetup | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const ask = (): void => void api.chromeStatus().then(setStatus)
    ask()
    const timer = setInterval(ask, 3000)
    return () => clearInterval(timer)
  }, [])

  const extensionDir = setup?.extensionDir || status?.extensionDir || ''

  const copyPath = (): void => {
    if (extensionDir) {
      void navigator.clipboard.writeText(extensionDir)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <>
      <TabHeader
        title="LeetCode"
        description="How much help you get on a problem, and the one step that lets Lilo see the page."
      />
      <Group title="How much help" note="A ceiling, not a personality. Cheering, and reading the state back, are the same at every level.">
        <div className="flex flex-col gap-2.5">
          {TIERS.map((tier) => (
            <div key={tier} className="flex items-center gap-3">
              <Action
                className="w-[92px] shrink-0"
                on={profile.tier === tier}
                onClick={() => save({ tier })}
              >
                {TIER_LABEL[tier]}
              </Action>
              <p className="m-0 text-[13px] leading-[1.5]" style={{ color: 'var(--ink-soft)' }}>
                {TIER_NOTE[tier]}
              </p>
            </div>
          ))}
        </div>
      </Group>

      <Group
        title="Chrome"
        note="Lilo reads the editor on leetcode.com through a small extension you load once. What it sees goes to the model you configured and nowhere else."
      >
        <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-[var(--rule)]">
          <span className="text-[13px] font-medium text-[var(--ink)]">Connection status</span>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors ${
              status?.connected
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                : 'bg-[var(--raised)] text-[var(--dim)] border-[var(--rule-strong)]'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                status?.connected ? 'bg-emerald-500' : 'bg-[var(--faint)]'
              }`}
            />
            {status === null ? 'Checking…' : status.connected ? 'Connected' : 'Not connected'}
          </span>
        </div>

        <div className="flex flex-col">
          {/* Step 1 */}
          <div className="flex gap-3 relative">
            <div className="flex flex-col items-center">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0 border ${
                  setup?.ok
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                    : 'bg-[var(--raised)] border-[var(--rule-strong)] text-[var(--ink)]'
                }`}
              >
                {setup?.ok ? '✓' : '1'}
              </div>
              <div className="w-px flex-1 bg-[var(--rule)] my-1.5" />
            </div>
            <div className="flex-1 pb-4">
              <h3 className="text-[13.5px] font-semibold text-[var(--ink)] m-0 leading-[20px]">
                Register native messaging host
              </h3>
              <p className="mt-1 mb-2 text-[13px] leading-[1.5] text-[var(--ink-soft)]">
                Writes the native host manifest and launcher so Chrome can talk to Lilo.
              </p>
              <div className="flex items-center gap-2.5">
                <Action
                  disabled={connecting}
                  onClick={() => {
                    setConnecting(true)
                    void api
                      .connectChrome()
                      .then(setSetup)
                      .finally(() => setConnecting(false))
                  }}
                >
                  {connecting ? 'Setting up…' : setup?.ok ? 'Re-run host setup' : 'Set up Chrome'}
                </Action>
                {setup?.ok && (
                  <span className="text-[12px] text-[var(--dim)]">Host manifest installed</span>
                )}
              </div>
              {setup && !setup.ok && (
                <p className="mt-2 text-[12.5px]" style={{ color: 'var(--live)' }}>
                  {setup.detail}
                </p>
              )}
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex gap-3 relative">
            <div className="flex flex-col items-center">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-semibold bg-[var(--raised)] border border-[var(--rule-strong)] text-[var(--ink)] shrink-0">
                2
              </div>
              <div className="w-px flex-1 bg-[var(--rule)] my-1.5" />
            </div>
            <div className="flex-1 pb-4">
              <h3 className="text-[13.5px] font-semibold text-[var(--ink)] m-0 leading-[20px]">
                Enable Developer mode in Chrome
              </h3>
              <p className="mt-1 text-[13px] leading-[1.5] text-[var(--ink-soft)]">
                Open <span className="input-mono px-1.5 py-0.5 rounded bg-[var(--raised)] border border-[var(--rule)] text-[var(--ink)] select-all text-[12px]">chrome://extensions</span> in Chrome and toggle on <strong>Developer mode</strong> in the top-right corner.
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex gap-3 relative">
            <div className="flex flex-col items-center">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-semibold bg-[var(--raised)] border border-[var(--rule-strong)] text-[var(--ink)] shrink-0">
                3
              </div>
              <div className="w-px flex-1 bg-[var(--rule)] my-1.5" />
            </div>
            <div className="flex-1 pb-4">
              <h3 className="text-[13.5px] font-semibold text-[var(--ink)] m-0 leading-[20px]">
                Load the unpacked extension
              </h3>
              <p className="mt-1 text-[13px] leading-[1.5] text-[var(--ink-soft)]">
                Click <strong>Load unpacked</strong> and pick this folder:
              </p>
              <div className="mt-2 p-2.5 rounded-lg border border-[var(--rule-strong)] bg-[var(--well)] flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-[var(--dim)]">Extension directory</span>
                  <div className="flex items-center gap-1.5">
                    <Action onClick={copyPath} className="!py-0.5 !px-2.5 !text-[12px]">
                      {copied ? 'Copied!' : 'Copy path'}
                    </Action>
                    <Action onClick={() => api.revealExtension()} className="!py-0.5 !px-2.5 !text-[12px]">
                      Show folder
                    </Action>
                  </div>
                </div>
                <div className="input-mono text-[12.5px] text-[var(--ink)] select-all break-all leading-normal bg-[var(--raised)] p-2 rounded border border-[var(--rule)]">
                  {extensionDir || 'Loading path…'}
                </div>
              </div>
            </div>
          </div>

          {/* Step 4 */}
          <div className="flex gap-3 relative">
            <div className="flex flex-col items-center">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0 border ${
                  status?.connected
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                    : 'bg-[var(--raised)] border-[var(--rule-strong)] text-[var(--ink)]'
                }`}
              >
                {status?.connected ? '✓' : '4'}
              </div>
            </div>
            <div className="flex-1 pb-1">
              <h3 className="text-[13.5px] font-semibold text-[var(--ink)] m-0 leading-[20px]">
                Open a problem on LeetCode
              </h3>
              <p className="mt-1 text-[13px] leading-[1.5] text-[var(--ink-soft)]">
                Navigate to any problem on <button type="button" onClick={() => api.openLink('https://leetcode.com/problemset/')} className="underline hover:text-[var(--ink)] cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit">leetcode.com</button>. The status above turns to <strong>Connected</strong> once the extension reaches the companion.
              </p>
              <p className="mt-2 text-[12.5px] leading-[1.5] text-[var(--dim)]">
                Tip: Restart Chrome if it was already open before step 1.
              </p>
            </div>
          </div>
        </div>
      </Group>
    </>
  )
}

function obfuscatePath(fullPath: string): string {
  if (!fullPath) return ''
  const unixHome = fullPath.replace(/^(\/(?:Users|home)\/[^/]+)/, '~')
  if (unixHome !== fullPath) return unixHome
  return fullPath.replace(/^[a-zA-Z]:\\Users\\[^\\]+/i, '%USERPROFILE%')
}

function AdvancedTab({
  storage,
  settings,
  onForget
}: {
  storage: string
  settings: SettingsView
  onForget: () => void
}): ReactElement {
  const [copied, setCopied] = useState(false)
  const displayPath = obfuscatePath(storage)

  const copyStorage = (): void => {
    if (storage) {
      void navigator.clipboard.writeText(storage)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <>
      <TabHeader
        title="Advanced"
        description="Data storage location, keychain security, and machine-level reset."
      />

      <Group title="Storage & Security">
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-[13.5px] font-semibold text-[var(--ink)] block">
                Keychain encryption
              </span>
              <p className="m-0 mt-0.5 text-[13px] text-[var(--ink-soft)] leading-[1.5]">
                {settings.encrypted === false
                  ? 'No system keychain detected. Keys are saved in plain text on this device.'
                  : 'API keys are sealed with your operating system keychain (Keychain on macOS, DPAPI on Windows).'}
              </p>
            </div>
            <span
              className={`shrink-0 text-[12px] font-medium px-2.5 py-0.5 rounded-full border ${
                settings.encrypted === false
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                  : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
              }`}
            >
              {settings.encrypted === false ? 'Unencrypted' : 'Encrypted'}
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[13.5px] font-semibold text-[var(--ink)]">
                Local configuration file
              </span>
              <Action onClick={copyStorage} className="!py-0.5 !px-2.5 !text-[12px]">
                {copied ? 'Copied full path!' : 'Copy path'}
              </Action>
            </div>
            <div className="input-mono text-[12.5px] text-[var(--ink)] select-all break-all leading-normal bg-[var(--well)] p-2.5 rounded-lg border border-[var(--rule-strong)]">
              {displayPath || 'Loading path…'}
            </div>
            <p className="m-0 mt-1.5 text-[12.5px] text-[var(--dim)]">
              Usernames in file paths are abbreviated with <code className="input-mono text-[12px]">~</code> to avoid showing personal paths on screen.
            </p>
          </div>
        </div>
      </Group>

      <Group title="Danger zone">
        <div className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <span className="text-[13.5px] font-semibold text-[var(--ink)] block">
                Reset everything
              </span>
              <p className="m-0 mt-0.5 text-[13px] text-[var(--ink-soft)] leading-[1.5]">
                Erases your saved profile, model configurations, stored API keys, and local session data from this machine.
              </p>
            </div>
            <Action
              tone="danger"
              className="!text-[12.5px]"
              onClick={() => {
                if (!window.confirm('Forget your profile, your keys and everything else on this machine?')) return
                onForget()
              }}
            >
              Forget everything
            </Action>
          </div>
        </div>
      </Group>
    </>
  )
}
