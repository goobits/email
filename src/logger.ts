/**
 * Pluggable logger interface — intentionally identical to the one used by
 * `@goobits/security`, `@goobits/sitemap`, and `@goobits/logger`. Any
 * logger satisfying this shape can be passed to `createEmailService()`.
 *
 * @module @goobits/email
 */

export type LogContext = Record<string, unknown>

export interface Logger {
	debug(message: string, context?: LogContext): void
	info(message: string, context?: LogContext): void
	warn(message: string, context?: LogContext): void
	error(message: string, context?: LogContext): void
}

/** Default logger: swallows every call. */
export const noopLogger: Logger = Object.freeze({
	debug(): void {},
	info(): void {},
	warn(): void {},
	error(): void {}
})

/** @internal — resolve a caller-supplied logger, falling back to noop. */
export function resolveLogger(logger?: Logger): Logger {
	return logger ?? noopLogger
}
