/**
 * A minimal `XMLHttpRequest` that delegates to whatever `globalThis.fetch` is.
 *
 * `client.ts` sends the two BIG upload bodies over XHR — it is the only portable
 * way to observe upload progress and the reason the progress bar is honest. The
 * upload suites, however, assert on request SHAPE through a `fetch` mock, and
 * they are the accumulated record of every part/retry/cleanup bug this protocol
 * has had. Rewriting them onto a second mock surface would have meant rewriting
 * those assertions, i.e. re-deriving the fences rather than keeping them.
 *
 * So the shim funnels XHR back into the same `fetch` mock: one place to route
 * requests, one shape of assertion, and the transport swap stays invisible to
 * every existing test. It also emits real `upload.progress` events, which is
 * what makes "the bar reports intermediate bytes" assertable at all — a
 * fetch-only mock has no such event to emit.
 *
 * It is deliberately NOT a general XHR polyfill: only the surface `client.ts`
 * touches is implemented, so a future call that reaches for anything else fails
 * loudly here instead of silently doing nothing.
 */
type Listener = (event: unknown) => void;

/** How many intermediate `progress` ticks to emit before the body is complete.
 *  Two, because one tick cannot distinguish "reports progress" from "reports
 *  the end", which is exactly the bug the suites are fencing. */
const PROGRESS_TICKS = 2;

export interface XhrShimOptions {
	/** Byte total to advertise when the body's own size is unknowable (FormData
	 *  has no `.size`). Mirrors a real multipart envelope: file bytes + framing. */
	fallbackTotal?: number;
}

export class FetchBackedXhr {
	static options: XhrShimOptions = {};

	status = 0;
	statusText = '';
	responseText = '';

	#method = 'GET';
	#url = '';
	#headers: Record<string, string> = {};
	#controller = new AbortController();
	#listeners = new Map<string, Listener[]>();
	#uploadListeners = new Map<string, Listener[]>();
	#done = false;

	readonly upload = {
		addEventListener: (type: string, fn: Listener) => this.#addUpload(type, fn)
	};

	open(method: string, url: string): void {
		this.#method = method;
		this.#url = url;
	}

	setRequestHeader(name: string, value: string): void {
		this.#headers[name] = value;
	}

	addEventListener(type: string, fn: Listener): void {
		const existing = this.#listeners.get(type) ?? [];
		this.#listeners.set(type, [...existing, fn]);
	}

	abort(): void {
		// Real XHR aborts the transfer; the shim aborts the signal the fetch mock
		// is watching, which is what `hangUntilDeadline`-style handlers settle on.
		this.#controller.abort();
	}

	send(body: unknown): void {
		void this.#run(body);
	}

	#addUpload(type: string, fn: Listener): void {
		const existing = this.#uploadListeners.get(type) ?? [];
		this.#uploadListeners.set(type, [...existing, fn]);
	}

	#emit(type: string, event: unknown): void {
		for (const fn of this.#listeners.get(type) ?? []) fn(event);
	}

	#emitUpload(loaded: number, total: number): void {
		for (const fn of this.#uploadListeners.get('progress') ?? []) {
			fn({ lengthComputable: true, loaded, total });
		}
	}

	async #run(body: unknown): Promise<void> {
		const total =
			typeof (body as { size?: number })?.size === 'number'
				? (body as { size: number }).size
				: (FetchBackedXhr.options.fallbackTotal ?? 1024);

		try {
			const response = (await fetch(this.#url, {
				method: this.#method,
				headers: this.#headers,
				body: body as BodyInit,
				signal: this.#controller.signal
			} as RequestInit)) as unknown as {
				ok?: boolean;
				status?: number;
				statusText?: string;
				json?: () => Promise<unknown>;
			};
			if (this.#done) return;

			// Progress is emitted only for a request that actually answered: a
			// transfer that died mid-body must not have already claimed 100%.
			for (let tick = 1; tick <= PROGRESS_TICKS; tick++) {
				this.#emitUpload(Math.round((total * tick) / PROGRESS_TICKS), total);
			}

			this.status = response.status ?? 200;
			this.statusText = response.statusText ?? '';
			if (typeof response.json === 'function') {
				try {
					this.responseText = JSON.stringify(await response.json());
				} catch {
					this.responseText = '';
				}
			} else {
				this.responseText = '';
			}
			if (this.#done) return;
			this.#done = true;
			this.#emit('load', {});
		} catch {
			if (this.#done) return;
			this.#done = true;
			this.#emit('error', {});
		}
	}
}

/**
 * Install the shim as the global `XMLHttpRequest` for the current test file.
 * Call inside `beforeEach`; `vi.restoreAllMocks()`/`unstubAllGlobals` in the
 * suite's `afterEach` puts the real one back.
 */
export function installXhrFetchShim(
	stubGlobal: (name: string, value: unknown) => void,
	options: XhrShimOptions = {}
): void {
	FetchBackedXhr.options = options;
	stubGlobal('XMLHttpRequest', FetchBackedXhr);
}
