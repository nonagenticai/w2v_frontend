/** "5m ago" / "2h ago" / "3d ago". Pass `now` (e.g. `useNow().current`) to keep a
 *  rendered age ticking; it defaults to the wall clock at call time. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
	const then = new Date(iso).getTime();
	const diffMs = now - then;

	if (diffMs < 0) return 'just now';

	const diffSec = Math.floor(diffMs / 1000);
	const diffMin = Math.floor(diffSec / 60);
	const diffHour = Math.floor(diffMin / 60);
	const diffDay = Math.floor(diffHour / 24);

	if (diffSec < 60) return 'just now';
	if (diffMin < 60) return `${diffMin}m ago`;
	if (diffHour < 24) return `${diffHour}h ago`;
	return `${diffDay}d ago`;
}

/** Absolute date-time, e.g. "3 Jun 2026, 14:32". Returns '' for null/empty so
 *  callers can render an em-dash for unfinished projects. */
export function formatDateTime(iso: string | null | undefined): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleString(undefined, {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}

export function extractHostname(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '');
	} catch {
		return url;
	}
}

/**
 * The URL's host, filename-safe — mirrors the orchestrator's audit-report
 * `host_of`: lower-cased, restricted to `[a-z0-9.-]` (it lands in a filename /
 * Content-Disposition), `"report"` when there is none.
 */
export function fileSafeHost(url: string | null | undefined): string {
	let host: string;
	try {
		host = url ? new URL(url).hostname : '';
	} catch {
		host = '';
	}
	return host.toLowerCase().replace(/[^a-z0-9.-]/g, '') || 'report';
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatTimestamp(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** First 8 chars of an id for compact display, or `fallback` when null/empty.
 *  The fallback is caller-chosen on purpose: the per-request audit renders an
 *  em-dash ('—', absent) for a missing actor/tenant, while the deliberate-action
 *  audit renders 'system' for a null actor (a system-initiated action). */
export function shortId(id: string | null | undefined, fallback = '—'): string {
	return id ? id.slice(0, 8) : fallback;
}

/** "1 entry" / "2 entries" / "0 lessons". `pluralForm` defaults to
 *  `singular + 's'`; pass it for irregular nouns. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}
