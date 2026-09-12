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

type Tab = 'profile' | 'model' | 'leetcode'

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
  }
]

/** Reopening should land where you were, which needs no round trip to ask. */
function lastTab(): Tab {
  try {
    const saved = localStorage.getItem('prefs-tab')
    return saved === 'model' || saved === 'leetcode' ? saved : 'profile'
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
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {TABS.map((one) => (
            <button key={one.value} data-on={tab === one.value} onClick={() => pick(one.value)}>
              {one.icon}
              {one.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="pane">
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
            ) : (
              <ModelTab settings={settings} save={saveSettings} />
            )}
          </div>
        </div>

        <footer className="pane-foot">
          <p className="m-0 min-w-0 flex-1 text-[11px] leading-[1.6]" style={{ color: 'var(--faint)' }}>
            {settings?.encrypted === false
              ? 'No keychain here, so keys sit in plain text.'
              : 'Keys are in your keychain.'}{' '}
            {/* One line, clipped: a path broken mid-word is worse than a path you hover. */}
            <span className="input-mono block truncate" title={storage}>
              {storage}
            </span>
          </p>
          <span
            className="shrink-0 text-[11.5px] transition-opacity duration-300"
            style={{ color: 'var(--dim)', opacity: saved ? 1 : 0 }}
          >
            Saved
          </span>
          <Action
            tone="danger"
            onClick={() => {
              if (!window.confirm('Forget your profile, your keys and everything else?')) return
              void api.forgetSettings().then(setSettings)
              void api.readProfile().then(setProfile)
            }}
          >
            Forget everything
          </Action>
        </footer>
      </div>
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
      <p className="lede">
        What the companion tailors itself to: which engineering postings it shows you, and who the work comes from.
      </p>
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
          <p className="text-[12px]" style={{ color: 'var(--faint)' }}>
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
 * Typed in their own words, then answered by the data. Showing what each phrase
 * landed on keeps the app from quietly filtering on something else, and says
 * plainly when there is nothing behind it.
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
      <p className="lede">
        Any model you can reach: a hosted service, or one running on this machine. How the endpoint
        speaks is worked out from its address.
      </p>
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

  useEffect(() => {
    const ask = (): void => void api.chromeStatus().then(setStatus)
    ask()
    const timer = setInterval(ask, 3000)
    return () => clearInterval(timer)
  }, [])

  return (
    <>
      <p className="lede">
        How much help you get on a problem, and the one step that lets Lilo see the page.
      </p>
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
              <p className="m-0 text-[12px] leading-[1.5]" style={{ color: 'var(--dim)' }}>
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
        <div className="flex flex-wrap items-center gap-2.5">
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
            {connecting ? 'Setting up…' : 'Set up Chrome'}
          </Action>
          <Action onClick={() => api.revealExtension()}>Show the extension folder</Action>
          <span
            className="text-[12px] ml-1.5"
            style={{ color: status?.connected ? 'var(--ink)' : 'var(--faint)' }}
          >
            {status === null ? 'Asking…' : status.connected ? '● Connected' : '○ Not connected'}
          </span>
        </div>
        {setup && !setup.ok && (
          <p className="mt-2.5 text-[12px]" style={{ color: 'var(--live)' }}>
            {setup.detail}
          </p>
        )}
        {setup?.ok && (
          <ol className="mt-3 pl-4 text-[12px] leading-[1.7]" style={{ color: 'var(--dim)' }}>
            <li>Open chrome://extensions and turn on Developer mode.</li>
            <li>
              Press Load unpacked and pick{' '}
              <span className="input-mono" title={setup.extensionDir}>
                {setup.extensionDir}
              </span>
              .
            </li>
            <li>Open a problem on leetcode.com. This page says Connected once the extension has reached the app.</li>
            <li>Restart Chrome if it was open before the first step.</li>
          </ol>
        )}
      </Group>
    </>
  )
}
