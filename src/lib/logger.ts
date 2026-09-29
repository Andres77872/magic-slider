import type { AppError } from './errors'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  level: LogLevel
  message: string
  context?: Record<string, unknown>
  error?: AppError | Error | unknown
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>, error?: AppError | Error | unknown): void
}

function writeConsole(entry: LogEntry): void {
  const payload = entry.context ? [entry.message, entry.context, entry.error].filter(Boolean) : [entry.message, entry.error].filter(Boolean)

  if (entry.level === 'debug') {
    console.debug(...payload)
    return
  }

  if (entry.level === 'info') {
    console.info(...payload)
    return
  }

  if (entry.level === 'warn') {
    console.warn(...payload)
    return
  }

  console.error(...payload)
}

export function createLogger(writer: (entry: LogEntry) => void = writeConsole): Logger {
  return {
    debug(message, context) {
      writer({ level: 'debug', message, context })
    },
    info(message, context) {
      writer({ level: 'info', message, context })
    },
    warn(message, context) {
      writer({ level: 'warn', message, context })
    },
    error(message, context, error) {
      writer({ level: 'error', message, context, error })
    },
  }
}

export const logger = createLogger()
