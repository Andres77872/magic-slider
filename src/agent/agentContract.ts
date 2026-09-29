export const agentContract = {
  request: {
    method: 'POST',
    route: 'Frontend posts to an OpenAI-compatible /v1/chat/completions endpoint. Local development uses the browser-reachable http://localhost:7000/v1/chat/completions URL.',
    body: {
      model: 'Configured by VITE_AGENT_MODEL as an agt-* public agent id/routing key, not the provider model.',
      messages: 'Every request starts with one system message: the bounded current deck context when a validated deck exists, followed by a client context line with today\'s date and time zone. Then come at most the last 15 eligible user/assistant messages from the selected session only, and finally the unchanged user prompt exactly once.',
      deckState: 'Frontend-only optional ValidatedPresentationConfig context. Omitted, undefined, or null deckState preserves the single user-message request shape.',
      stream: true,
    },
  },
  stateAwareDeckContext: {
    status: 'Implemented in the frontend client slice.',
    format: '[system deck context, user prompt] only when a validated deckState exists; [user prompt] otherwise.',
    targeting: 'The system context includes slideCount, zero-based slideIndex/afterIndex/fromIndex/toIndex guidance, ordered slide summaries, and create_deck guidance for explicit new-deck requests only.',
    nonChanges: 'No backend endpoint, API routing, agent JSON, public tool schema, provider model routing, Zod relaxation, raw HTML support, or DOMPurify change is part of this contract.',
  },
  localSessionContext: {
    status: 'Frontend-only and storage-free at the request boundary.',
    source: 'Only explicit runtime messages from the currently selected local session may be passed into request construction.',
    forbiddenSources: 'agentClient never reads localStorage, other sessions, raw persisted blobs, backend history, archived/non-selected sessions, status/tool/debug noise, or unbounded local history.',
    order: '[system: optional deck context + client date], [last 15 selected-session user/assistant messages], [current user prompt exactly once].',
  },
  stream: {
    transport: 'Server-sent-event style text stream.',
    eventShape: 'Each blank-line-delimited event joins its data lines and may contain a generated text delta, OpenAI delta.tool_calls/message.tool_calls, or the literal [DONE]. LF, CRLF, and CR line endings are supported across transport chunks.',
    toolCalls: 'Known presentation tool calls are schema-only client actions with canonical function.name values and additive execution/source metadata.',
    metadata: 'execution and source are optional additive extension fields; standard OpenAI id/index/type/function fields remain unchanged.',
    completionMarker: '[DONE] is required before applying output; premature EOF, error events, and error/length/content_filter finish reasons fail without applying actions.',
    malformedEvents: 'Malformed event payloads are classified as stream-corruption diagnostics, never silently swallowed.',
    actionApplication: 'All tool actions are validated and reduced in stream index order against the current deck before callbacks run. Successful results include the final deck after every action, including edit-only requests.',
    cleanup: 'The client cancels its reader, releases the stream lock, and aborts transport on every exit.',
    progress: 'Progress reports sending, first content/tool receipt, and post-completion validation at most once per phase. Receiving updates never implies that deck changes have been applied.',
  },
  auth: {
    localDevelopment: 'Authentication requirements depend on the backend serving http://localhost:7000/v1/chat/completions. Configure the optional bearer token when that backend requires credentials.',
    behavior: 'Authorization is optional and only sent when a real configured credential exists for environments that require one.',
    forbiddenPlaceholder: 'Bearer NONE must never be sent as a credential.',
  },
  evidenceScope: {
    frontendOnly: 'This contract records frontend config/client expectations and manual browser-smoke evidence only.',
    excluded: 'It does not prove backend repository, agent-service, deployed API, or production-auth correctness.',
  },
  limits: {
    totalTimeout: 'The client owns a total request timeout covering response headers and successful or unsuccessful response bodies.',
    idleTimeout: 'The client owns an idle stream timeout reset on response headers and each body chunk.',
    maxStreamBytes: 'The client stops accumulation when the configured response-size limit is exceeded. HTTP error diagnostics retain at most 4096 bytes within the configured size limit.',
  },
  errors: {
    provider: 'HTTP failures are mapped to typed auth, rate-limit, or HTTP errors.',
    transport: 'Network, cancellation, timeout, missing body, and stream corruption are typed failures.',
    parsing: 'Extracted JSON parse failures are typed json-parse failures.',
    validation: 'Parsed values remain unknown until Zod validation succeeds.',
  },
  futureWork: {
    progressiveToolLifecycle: 'Request/receiving/validation progress is implemented. Detailed per-tool execution lifecycle UX, tool_result fidelity, undo/history, and authenticated thread-native flows are deferred.',
    nonStreamingToolCalls: 'Complete non-streaming-style message.tool_calls are accepted when delivered through the public completion envelope.',
    structuredBlocks: 'Structured block output is future backend contract work and is not implemented by this change.',
    slideRegeneration: 'Slide-level regeneration is future backend/product work and is not implemented by this change.',
  },
} as const

export type AgentContract = typeof agentContract
