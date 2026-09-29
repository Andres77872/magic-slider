export const appErrorCategories = [
  'configuration',
  'auth',
  'http',
  'rate-limit',
  'network',
  'timeout',
  'cancellation',
  'stream-corruption',
  'json-parse',
  'validation',
  'size-limit',
  'unsafe-legacy-content',
  'plugin',
  'render',
  'reveal-initialization',
] as const

export type AppErrorCategory = (typeof appErrorCategories)[number]

export interface AppErrorDiagnostic {
  path?: string
  code?: string
  message: string
  details?: unknown
}

export interface AppError {
  category: AppErrorCategory
  message: string
  recovery: string
  diagnostics?: AppErrorDiagnostic[]
  cause?: unknown
}

export type GenerationError = AppError & {
  category:
    | 'configuration'
    | 'auth'
    | 'http'
    | 'rate-limit'
    | 'network'
    | 'timeout'
    | 'cancellation'
    | 'stream-corruption'
    | 'json-parse'
    | 'validation'
    | 'size-limit'
    | 'unsafe-legacy-content'
    | 'plugin'
}

export type RenderError = AppError & {
  category: 'render' | 'reveal-initialization' | 'plugin' | 'unsafe-legacy-content'
}

const errorCopy: Record<AppErrorCategory, { message: string; recovery: string }> = {
  configuration: {
    message: 'Agent configuration is missing or invalid.',
    recovery: 'Check the frontend environment variables before trying again.',
  },
  auth: {
    message: 'The agent provider rejected the configured credentials.',
    recovery: 'Verify the optional API token or remove it when the endpoint does not require auth.',
  },
  http: {
    message: 'The agent provider returned an unsuccessful response.',
    recovery: 'Retry later or inspect the provider response diagnostics.',
  },
  'rate-limit': {
    message: 'The agent provider rate limit was reached.',
    recovery: 'Wait before retrying or reduce request frequency.',
  },
  network: {
    message: 'The browser could not reach the agent provider.',
    recovery: 'Check connectivity and the configured API endpoint.',
  },
  timeout: {
    message: 'The generation request timed out.',
    recovery: 'Retry with a shorter prompt or increase the configured timeout.',
  },
  cancellation: {
    message: 'Generation was cancelled.',
    recovery: 'Start a new generation when ready.',
  },
  'stream-corruption': {
    message: 'The streamed agent response was malformed.',
    recovery: 'Retry and inspect stream diagnostics if the issue persists.',
  },
  'json-parse': {
    message: 'The agent response did not contain valid presentation JSON.',
    recovery: 'Retry generation; the response may have been truncated or malformed.',
  },
  validation: {
    message: 'The generated presentation failed runtime validation.',
    recovery: 'Retry generation or inspect schema diagnostics for unsupported fields.',
  },
  'size-limit': {
    message: 'The agent response exceeded the configured size limit.',
    recovery: 'Use a smaller prompt or raise the configured max stream size.',
  },
  'unsafe-legacy-content': {
    message: 'Legacy raw HTML content is not allowed in the default generation path.',
    recovery: 'Clean the content to text or migrate it to a future structured-block format.',
  },
  plugin: {
    message: 'The presentation referenced an unsupported Reveal plugin.',
    recovery: 'Use only supported plugin names or add the plugin to the typed registry.',
  },
  render: {
    message: 'The presentation could not be rendered safely.',
    recovery: 'Inspect render diagnostics and remove unsupported generated DOM data.',
  },
  'reveal-initialization': {
    message: 'Reveal.js failed to initialize the deck.',
    recovery: 'Retry rendering or inspect Reveal lifecycle diagnostics.',
  },
}

export function createAppError(input: {
  category: AppErrorCategory
  message?: string
  recovery?: string
  diagnostics?: AppErrorDiagnostic[]
  cause?: unknown
}): AppError {
  const defaults = errorCopy[input.category]

  return {
    category: input.category,
    message: input.message ?? defaults.message,
    recovery: input.recovery ?? defaults.recovery,
    diagnostics: input.diagnostics,
    cause: input.cause,
  }
}

export function getUserErrorMessage(error: AppError): string {
  return `${error.message} ${error.recovery}`
}
