import React, { useEffect, useRef, useState } from 'react'
import { generatePresentation } from '../agent/agentClient'
import type { GeneratePresentationInput, GeneratePresentationResult } from '../agent/agentClient'
import type { ApplyPresentationActionResult } from '../agent/presentationActionReducer'
import { describeDeckOutcome, describePresentationAction } from '../lib/presentationCopy'
import { getAppConfig, type AppConfig } from '../config'
import type { PresentationAction, ValidatedPresentationConfig } from '../domain/presentationTypes'
import { getUserErrorMessage, type AppError, type GenerationError } from '../lib/errors'
import { LOCAL_SESSION_MESSAGE_MAX_LENGTH, selectedSessionConversationContext, type LocalSessionMessage } from '../session/localSessionModel'
import ExampleCatalog from './ExampleCatalog'
import { examplePreferences, type PresentationExample } from '../lib/exampleCatalog'
import {
  audienceOptions,
  defaultBriefPreferences,
  themeOptions,
  toneOptions,
  withBriefPreferences,
  type BriefPreferences,
} from '../lib/briefPreferences'

type WorkspaceMessage = {
  id: string | number
  kind: 'user' | 'assistant' | 'status' | 'tool'
  text: string
}

export type GenerationOrigin = {
  sessionId: string
  attemptId: string
}

export type CommittedGenerationMessage = Omit<LocalSessionMessage, 'id' | 'createdAt'>

interface ChatbotProps {
  mode?: 'home' | 'workspace'
  sessionId: string
  deckState?: ValidatedPresentationConfig | null
  onGenerate: (config: ValidatedPresentationConfig, origin: GenerationOrigin, committedMessages: CommittedGenerationMessage[]) => void
  onConversation?: (origin: GenerationOrigin, messages: CommittedGenerationMessage[]) => void
  onPresentationAction?: (action: PresentationAction, origin: GenerationOrigin) => ApplyPresentationActionResult | void
  onGeneratingStateChange?: (generating: boolean, origin: GenerationOrigin) => void
  generatePresentationClient?: (input: GeneratePresentationInput) => Promise<GeneratePresentationResult>
  loadConfig?: () => AppConfig
  sessionMessages?: LocalSessionMessage[]
  onAppendSessionMessage?: (message: Omit<LocalSessionMessage, 'id' | 'createdAt'>, options?: { flush?: boolean }) => void
  disabledReason?: string | null
}

const Chatbot: React.FC<ChatbotProps> = ({
  mode = 'home',
  sessionId,
  deckState,
  onGenerate,
  onConversation,
  onPresentationAction,
  onGeneratingStateChange,
  generatePresentationClient = generatePresentation,
  loadConfig = getAppConfig,
  sessionMessages,
  disabledReason,
}) => {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultJson, setResultJson] = useState('')
  const [showJson, setShowJson] = useState(false)
  const [workspaceMessages, setWorkspaceMessages] = useState<WorkspaceMessage[]>([])
  const [attemptMessages, setAttemptMessages] = useState<WorkspaceMessage[]>([])
  const [generationStatus, setGenerationStatus] = useState<string | null>(null)
  const [preferences, setPreferences] = useState<BriefPreferences>(defaultBriefPreferences)
  const [showPreferences, setShowPreferences] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [loadedExample, setLoadedExample] = useState<PresentationExample | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const activeAttemptRef = useRef<(GenerationOrigin & { controller: AbortController }) | null>(null)
  const mountedRef = useRef(true)
  const messageIdRef = useRef(0)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)

  const isWorkspaceMode = mode === 'workspace'
  // Defaults match the agent's own behavior, so only explicit choices are sent.
  const sentPreferences = !isWorkspaceMode && JSON.stringify(preferences) !== JSON.stringify(defaultBriefPreferences) ? preferences : undefined
  const promptLimit = LOCAL_SESSION_MESSAGE_MAX_LENGTH - (withBriefPreferences('', sentPreferences).length)
  const pendingLabel = isWorkspaceMode ? 'Preparing changes…' : 'Creating presentation…'
  const isInteractionDisabled = Boolean(disabledReason)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortControllerRef.current?.abort()
      activeAttemptRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!loading) return undefined
    const startedAt = Date.now()
    setElapsedSeconds(0)
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [loading])

  const isOwningAttempt = (origin: GenerationOrigin, controller: AbortController) => {
    const activeAttempt = activeAttemptRef.current
    return Boolean(
      mountedRef.current &&
      activeAttempt &&
      activeAttempt.sessionId === origin.sessionId &&
      activeAttempt.attemptId === origin.attemptId &&
      activeAttempt.controller === controller &&
      !controller.signal.aborted,
    )
  }

  const setGenerating = (generating: boolean, origin: GenerationOrigin) => {
    if (!mountedRef.current) return
    setLoading(generating)
    onGeneratingStateChange?.(generating, origin)
  }

  const displayedWorkspaceMessages: WorkspaceMessage[] = sessionMessages
    ? [...sessionMessages, ...attemptMessages]
    : [...workspaceMessages, ...attemptMessages]

  useEffect(() => {
    const history = historyRef.current
    if (history) history.scrollTop = history.scrollHeight
  }, [displayedWorkspaceMessages.length])

  const toWorkspaceMessage = (message: CommittedGenerationMessage): WorkspaceMessage => {
    messageIdRef.current += 1
    return { id: messageIdRef.current, kind: message.kind, text: message.text }
  }

  const appendLocalAttemptMessage = (message: CommittedGenerationMessage) => {
    if (!mountedRef.current) return
    const workspaceMessage = toWorkspaceMessage(message)
    setAttemptMessages((messages) => [...messages, workspaceMessage])
  }

  const showError = (generationError: GenerationError) => {
    if (generationError.category === 'cancellation') return
    const message = getUserErrorMessage(generationError)
    setError(message)
    setAttemptMessages([])
    appendLocalAttemptMessage({ kind: 'status', text: `Generation failed. ${message} You can edit your prompt and retry.` })
  }

  const isAppError = (value: unknown): value is AppError => {
    return Boolean(value && typeof value === 'object' && 'category' in value && 'message' in value && 'recovery' in value)
  }

  const handleCancel = () => {
    const activeAttempt = activeAttemptRef.current
    abortControllerRef.current?.abort()
    if (!activeAttempt || !mountedRef.current) return
    activeAttemptRef.current = null
    abortControllerRef.current = null
    setGenerationStatus(null)
    setAttemptMessages([])
    setGenerating(false, { sessionId: activeAttempt.sessionId, attemptId: activeAttempt.attemptId })
  }

  const handleGenerate = async () => {
    if (loading) return
    if (disabledReason) {
      setError(disabledReason)
      appendLocalAttemptMessage({ kind: 'status', text: disabledReason })
      return
    }
    if (!prompt.trim()) {
      setError('Please enter a prompt describing your presentation')
      appendLocalAttemptMessage({ kind: 'status', text: 'Please enter a prompt before generating. Edit your request and retry.' })
      return
    }

    if (prompt.length > LOCAL_SESSION_MESSAGE_MAX_LENGTH) {
      setError(`Keep your request within ${LOCAL_SESSION_MESSAGE_MAX_LENGTH.toLocaleString()} characters.`)
      return
    }

    const submittedPrompt = withBriefPreferences(prompt, sentPreferences)
    if (submittedPrompt.length > LOCAL_SESSION_MESSAGE_MAX_LENGTH) {
      setError(`Keep your request within ${promptLimit.toLocaleString()} characters with the selected presentation options.`)
      return
    }
    const origin: GenerationOrigin = { sessionId, attemptId: `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}` }
    const conversationContext = selectedSessionConversationContext(sessionMessages ?? workspaceMessages as LocalSessionMessage[])
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    activeAttemptRef.current = { ...origin, controller }
    setGenerating(true, origin)
    setError(null)
    setResultJson('')
    setGenerationStatus(null)
    setAttemptMessages([])
    const committedMessages: CommittedGenerationMessage[] = [
      { kind: 'user', text: submittedPrompt, apiRole: 'user' },
    ]
    committedMessages.forEach(appendLocalAttemptMessage)

    try {
      const config = loadConfig()
      let streamedText = ''
      let actionRejected = false
      const result = await generatePresentationClient({
        prompt: submittedPrompt,
        config,
        deckState,
        conversationContext,
        signal: controller.signal,
        onDelta: (delta) => {
          if (!isOwningAttempt(origin, controller)) return
          streamedText += delta
          setResultJson(streamedText)
        },
        onProgress: (message) => {
          if (!isOwningAttempt(origin, controller)) return
          setGenerationStatus(message)
        },
        onAction: (action) => {
          if (!isOwningAttempt(origin, controller)) return
          const actionResult = onPresentationAction?.(action, origin)
          if (!isOwningAttempt(origin, controller)) return
          if (actionResult && !actionResult.ok) {
            actionRejected = true
            showError(actionResult.error)
            appendLocalAttemptMessage({ kind: 'status', text: 'Validation blocked that presentation change. Review the prompt, adjust the request, and retry.' })
            return
          }
          appendLocalAttemptMessage({ kind: 'status', text: describePresentationAction(action) })
        },
      })

      if (!isOwningAttempt(origin, controller)) return
      if (result.ok) {
        setResultJson(result.kind === 'message' || result.message ? '' : result.rawText)
        if (actionRejected) return
        if (result.kind === 'message') {
          const messages: CommittedGenerationMessage[] = [...committedMessages, { kind: 'assistant', text: result.message, apiRole: 'assistant' }]
          onConversation?.(origin, messages)
          if (!isOwningAttempt(origin, controller)) return
          if (!sessionMessages) setWorkspaceMessages((previous) => [...previous, ...messages.map(toWorkspaceMessage)])
          setAttemptMessages([])
          setPrompt('')
          return
        }
        if (result.presentation) {
          const actionMessages: CommittedGenerationMessage[] = (result.actions ?? []).filter((action) => action.action !== 'create_deck').map((action) => ({
            kind: 'status',
            text: describePresentationAction(action),
          }))
          const summary = result.message ?? describeDeckOutcome(result.presentation, isWorkspaceMode ? 'updated' : 'created')
          const successMessages: CommittedGenerationMessage[] = [
            ...committedMessages,
            ...actionMessages,
            { kind: 'assistant', text: summary, apiRole: 'assistant' },
          ]
          successMessages.slice(committedMessages.length + actionMessages.length).forEach(appendLocalAttemptMessage)
          if (!isOwningAttempt(origin, controller)) return
          onGenerate(result.presentation, origin, successMessages)
          if (!isOwningAttempt(origin, controller)) return
          if (!sessionMessages) {
            setWorkspaceMessages((messages) => [...messages, ...successMessages.map(toWorkspaceMessage)])
          }
          setAttemptMessages([])
          setPrompt('')
        }
      } else {
        if (result.error.category === 'cancellation') {
          setAttemptMessages([])
          return
        }
        showError(result.error)
      }
    } catch (err) {
      if (isOwningAttempt(origin, controller)) {
        const message = isAppError(err) ? getUserErrorMessage(err) : err instanceof Error ? err.message : String(err)
        setError(message)
        setAttemptMessages([])
        appendLocalAttemptMessage({ kind: 'status', text: `Generation failed. ${message} You can edit your prompt and retry.` })
      }
    } finally {
      if (isOwningAttempt(origin, controller)) {
        activeAttemptRef.current = null
        if (abortControllerRef.current === controller) abortControllerRef.current = null
        setGenerationStatus(null)
        setGenerating(false, origin)
      } else if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleGenerate()
    }
  }

  const fillPrompt = (text: string) => {
    setPrompt(text)
    promptRef.current?.focus()
  }

  const selectExample = (example: PresentationExample) => {
    setLoadedExample(example)
    setPreferences(examplePreferences(example))
    setShowPreferences(true)
    setError(null)
    fillPrompt(example.prompt)
  }
  // The card stays marked only while the request still matches the example.
  const selectedExampleId = loadedExample && prompt === loadedExample.prompt ? loadedExample.id : null

  const updatePreference = <Key extends keyof BriefPreferences>(key: Key, value: BriefPreferences[Key]) => {
    setPreferences((current) => ({ ...current, [key]: value }))
  }

  const elapsedLabel = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`
  const inputDisabled = loading || isInteractionDisabled

  return (
    <div className={`chatbot-container chatbot-container--${mode}`}>
      {(isWorkspaceMode || displayedWorkspaceMessages.length > 0) && (
        <div ref={historyRef} className="workspace-chat-history" data-testid="workspace-chat-history" aria-live="polite">
          {displayedWorkspaceMessages.length === 0 ? (
            <div className="workspace-chat-empty" data-testid="workspace-chat-status">
              <p>Ask for changes to keep shaping this presentation.</p>
              <p className="workspace-chat-empty__hint">Refer to slides by number, for example “Tighten slide 3” or “Add a timeline after slide 4”.</p>
            </div>
          ) : (
            displayedWorkspaceMessages.map((message, index) => (
              <div
                key={message.id}
                className={`workspace-chat-message workspace-chat-message--${message.kind}`}
                data-testid={index === displayedWorkspaceMessages.length - 1 ? 'workspace-chat-status' : undefined}
              >
                {(message.kind === 'user' || message.kind === 'assistant') && (
                  <span className="workspace-chat-message__author">{message.kind === 'user' ? 'You' : 'Magic Slider'}</span>
                )}
                <p>{message.text}</p>
              </div>
            ))
          )}
        </div>
      )}

      <div
        className={`chatbot-form${isWorkspaceMode ? ' chatbot-form--workspace' : ''}`}
        data-testid={isWorkspaceMode ? 'workspace-chat-panel-form' : undefined}
        aria-busy={loading ? 'true' : undefined}
      >
        {loading && (
          <div className="chatbot-pending-status">
            <span className="chatbot-pending-status__pulse" aria-hidden="true" />
            <span className="chatbot-pending-status__text" role="status" aria-live="polite">{generationStatus ?? pendingLabel}</span>
            {/* The ticking clock stays out of the live region so it is not announced every second. */}
            <span className="chatbot-pending-status__time" aria-hidden="true">{elapsedLabel}</span>
            {elapsedSeconds >= 15 && (
              <span className="chatbot-pending-status__hint">Web research and original images can take a minute or two.</span>
            )}
          </div>
        )}

        {isWorkspaceMode && !loading && (
          <div className="quick-actions" role="group" aria-label="Suggested changes">
            {quickActions.map((action) => (
              <button key={action.label} type="button" className="chip" onClick={() => fillPrompt(action.prompt)} disabled={inputDisabled}>
                {action.label}
              </button>
            ))}
          </div>
        )}

        <div className="input-group">
          <label htmlFor="prompt-input" className="input-label">
            {isWorkspaceMode ? 'What would you like to change?' : 'What are we presenting?'}
          </label>
          <textarea
            ref={promptRef}
            id="prompt-input"
            aria-describedby="prompt-help"
            data-testid="prompt-input"
            className="form-control prompt-textarea"
            placeholder={isWorkspaceMode ? 'Ask for a slide edit, new section, sources, images or a new theme…' : 'Describe your topic, audience and goal… e.g. “A 7-slide briefing on urban heat islands for city planners”'}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            maxLength={promptLimit}
            rows={isWorkspaceMode ? 3 : 4}
          />
          <p className="input-help" id="prompt-help">{isWorkspaceMode ? 'Enter to send · Shift + Enter for a new line' : 'Include your topic, audience, and slide count. Enter to generate.'}{prompt.length >= promptLimit * .9 && ` · ${prompt.length.toLocaleString()}/${promptLimit.toLocaleString()} characters`}</p>
        </div>

        {!isWorkspaceMode && (
          <div className="brief-options">
            <button
              type="button"
              className="brief-options__toggle"
              aria-expanded={showPreferences}
              aria-controls="brief-options-panel"
              onClick={() => setShowPreferences((open) => !open)}
            >
              <span aria-hidden="true">{showPreferences ? '−' : '+'}</span> Presentation options
              <span className="brief-options__summary">
                {preferences.slideCount === 'auto' ? 'Auto length' : `${preferences.slideCount} slides`}
                {' · '}{preferences.theme === 'auto' ? 'Auto theme' : preferences.theme}
                {' · '}Research {preferences.research ? 'on' : 'off'}
                {' · '}Images {preferences.images ? 'on' : 'off'}
              </span>
            </button>
            {showPreferences && (
              <div id="brief-options-panel" className="brief-options__panel">
                <fieldset className="brief-field">
                  <legend>Length</legend>
                  <div className="segmented">
                    {(['auto', '5', '8', '12'] as const).map((count) => (
                      <label key={count} className="segmented__option">
                        <input type="radio" name="slide-count" value={count} checked={preferences.slideCount === count} onChange={() => updatePreference('slideCount', count)} disabled={inputDisabled} />
                        <span>{count === 'auto' ? 'Auto' : `${count} slides`}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="brief-field brief-field--row">
                  <label>
                    <span>Audience</span>
                    <select className="form-control" value={preferences.audience} onChange={(event) => updatePreference('audience', event.target.value)} disabled={inputDisabled}>
                      <option value="">Let Magic Slider decide</option>
                      {audienceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Tone</span>
                    <select className="form-control" value={preferences.tone} onChange={(event) => updatePreference('tone', event.target.value)} disabled={inputDisabled}>
                      <option value="">Let Magic Slider decide</option>
                      {toneOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                </div>
                <fieldset className="brief-field">
                  <legend>Theme</legend>
                  <div className="theme-picker">
                    <label className="theme-picker__option">
                      <input type="radio" name="deck-theme" value="auto" checked={preferences.theme === 'auto'} onChange={() => updatePreference('theme', 'auto')} disabled={inputDisabled} />
                      <span className="theme-picker__swatch theme-picker__swatch--auto" aria-hidden="true" />
                      <span>Auto</span>
                    </label>
                    {themeOptions.map((theme) => (
                      <label key={theme.value} className="theme-picker__option">
                        <input type="radio" name="deck-theme" value={theme.value} checked={preferences.theme === theme.value} onChange={() => updatePreference('theme', theme.value)} disabled={inputDisabled} />
                        <span className={`theme-picker__swatch theme-swatch--${theme.value}`} aria-hidden="true" />
                        <span>{theme.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="brief-field brief-field--toggles">
                  <label className="switch">
                    <input type="checkbox" checked={preferences.research} onChange={(event) => updatePreference('research', event.target.checked)} disabled={inputDisabled} />
                    <span className="switch__track" aria-hidden="true" />
                    <span><strong>Web research</strong> Cite current sources for facts and figures</span>
                  </label>
                  <label className="switch">
                    <input type="checkbox" checked={preferences.images} onChange={(event) => updatePreference('images', event.target.checked)} disabled={inputDisabled} />
                    <span className="switch__track" aria-hidden="true" />
                    <span><strong>Original images</strong> Generate a cover and supporting visuals</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="action-group">
          {loading && (
            <button
              type="button"
              data-testid="cancel-button"
              className="btn btn-secondary"
              onClick={handleCancel}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            data-testid="generate-button"
            className="btn btn-primary btn-generate"
            onClick={handleGenerate}
            disabled={loading || isInteractionDisabled || !prompt.trim()}
          >
            {loading ? (
              <>
                <span className="btn-spinner" aria-hidden="true"></span>
                {pendingLabel}
              </>
            ) : (
              <>
                <span className="btn-icon" aria-hidden="true">✦</span>
                {isWorkspaceMode ? 'Send' : 'Generate Slides'}
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="alert alert-error" role="alert" data-testid="generation-error">
            <span className="alert-icon" aria-hidden="true">!</span>
            <span>{error}</span>
          </div>
        )}

        {resultJson && (
          <div className="result-section">
            <div className="result-header">
              <h4>Response details</h4>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setShowJson(!showJson)}
                aria-expanded={showJson}
                aria-controls="response-json"
              >
                {showJson ? 'Hide' : 'Show'} JSON
              </button>
            </div>
            {showJson && (
              <pre id="response-json" className="result-json">{resultJson}</pre>
            )}
          </div>
        )}
      </div>

      {!isWorkspaceMode && (
        <>
          <p className="visually-hidden" role="status" aria-live="polite">
            {selectedExampleId && loadedExample ? `Loaded the ${loadedExample.title} example. Review the request and options, then generate.` : ''}
          </p>
          <ExampleCatalog selectedId={selectedExampleId} disabled={inputDisabled} onSelect={selectExample} />
        </>
      )}
    </div>
  )
}

const quickActions = [
  { label: 'Cite sources', prompt: 'Research and add sources to the slides that state facts or figures, and correct anything the sources contradict.' },
  { label: 'Tighten text', prompt: 'Tighten the wording on every slide: sharper takeaway titles and at most four short points per slide.' },
  { label: 'Add images', prompt: 'Add original images where they strengthen the story, keeping one consistent style.' },
  { label: 'Speaker notes', prompt: 'Write clear speaker notes for every slide, with transitions between slides.' },
  { label: 'Summary slide', prompt: 'Add a summary slide before the closing with the three key takeaways.' },
  { label: 'Light theme', prompt: 'Switch the deck to the paper theme.' },
]

export default Chatbot
