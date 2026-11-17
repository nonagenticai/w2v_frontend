<script lang="ts">
	import { Upload, Loader, AlertCircle, Trash2, RotateCw, Film, X } from '@lucide/svelte';
	import { uploads, type VideoSourceResponse } from '$lib/api';
	import {
		MAX_VIDEO_SOURCE_BYTES,
		uploadRowErrorMessage,
		uploadSideErrorMessage,
		validateVideoSource
	} from '$lib/api/uploads';
	import { formatFileSize } from '$lib/utils/format';
	import { randomId } from '$lib/utils/random-id';

	// `sources` is the SERVER's list — rows that exist in the DB. `queue` is the
	// local, transient view of files picked in this session. They are kept apart on
	// purpose: a failed clip must stay visible (with its reason, retryable) without
	// ever being counted as an uploaded source, and the wizard gates "next" on
	// `sources.length` alone.
	let {
		projectId,
		sources = $bindable<VideoSourceResponse[]>([]),
		disabledReason = ''
	}: {
		projectId: string | null;
		sources?: VideoSourceResponse[];
		disabledReason?: string;
	} = $props();

	type QueueRow = {
		/** Local key only — a File has no id and two clips can share a name. */
		key: string;
		file: File;
		status: 'queued' | 'uploading' | 'failed';
		error: string;
		/** 0..1, byte-grained on BOTH transports (see `VideoSourceUploadOptions`).
		 *  Before this existed a 134 MB clip showed a bare spinner for minutes with
		 *  no evidence it was moving, which is indistinguishable from a hang. */
		progress: number;
	};

	let queue = $state<QueueRow[]>([]);
	/**
	 * Per-row abort handles, held OUTSIDE `$state` on purpose: an AbortController
	 * is not data the template renders, and putting it in the reactive row object
	 * would make every progress tick re-proxy it. Keyed by `row.key`, and cleared
	 * in `pump`'s `finally` so a retried row never inherits a fired controller.
	 *
	 * A plain record rather than a `Map`, because `svelte/prefer-svelte-reactivity`
	 * (correctly) flags a mutable `Map` in a component — and the fix it wants,
	 * `SvelteMap`, is exactly what this must NOT be: reactive.
	 */
	const controllers: Record<string, AbortController | undefined> = {};
	/** Rows the operator cancelled. Read in the catch to tell "you stopped this"
	 *  apart from "this failed", which need different copy and different affordances. */
	let cancelled = $state<string[]>([]);
	let pumping = $state(false);
	let listError = $state('');
	let removing = $state<string | null>(null);

	const ACCEPT = '.mp4,.mov,.m4v,video/mp4,video/quicktime';

	const totalBytes = $derived(sources.reduce((sum, s) => sum + s.bytes, 0));
	const pending = $derived(queue.filter((r) => r.status === 'queued' || r.status === 'uploading'));
	const failed = $derived(queue.filter((r) => r.status === 'failed'));
	// Single announcement string for the live region: screen readers get one
	// coherent sentence per state change instead of a per-row firehose.
	const announcement = $derived(
		pending.length > 0
			? `Uploading clip ${sources.length + 1}. ${pending.length} remaining.`
			: failed.length > 0
				? `${failed.length} clip${failed.length === 1 ? '' : 's'} failed to upload. ${sources.length} uploaded.`
				: sources.length > 0
					? `${sources.length} clip${sources.length === 1 ? '' : 's'} uploaded, ${formatFileSize(totalBytes)} total.`
					: 'No clips uploaded yet.'
	);

	// Reconcile against the server whenever a project id appears (the draft is
	// pre-created asynchronously, and the operator may have come back to this step).
	// This is also the recovery path after a partial batch: whatever landed is
	// listed, so nothing silently disappears from the UI.
	$effect(() => {
		const id = projectId;
		if (!id) return;
		void (async () => {
			try {
				const res = await uploads.listVideoSources(id);
				sources = res.items;
				listError = '';
			} catch (err) {
				// Human copy, never ApiError's `${status} ${statusText}: ${detail}`
				// template — that put wire traces like "403 Forbidden: …" on screen.
				listError = uploadSideErrorMessage(err, 'Could not load uploaded clips.');
			}
		})();
	});

	function onPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const picked = Array.from(input.files ?? []);
		// Reset the input so re-picking the SAME file after a failure still fires
		// a change event.
		input.value = '';
		if (picked.length === 0) return;
		queue = [
			...queue,
			...picked.map((file) => ({
				key: `${file.name}:${file.size}:${file.lastModified}:${randomId()}`,
				file,
				// Pre-flight locally so an over-cap or wrong-extension clip is refused
				// instantly instead of after a 512 MB round trip.
				status: (validateVideoSource(file) ? 'failed' : 'queued') as QueueRow['status'],
				error: validateVideoSource(file) ?? '',
				progress: 0
			}))
		];
		void pump();
	}

	/**
	 * Upload one clip at a time. Sequential by design: these are 60–150 MB files
	 * and the pod streams each body through its own worker — firing ten in
	 * parallel spikes memory there and gives the operator no useful progress.
	 * A failure marks only its own row, so clips 1–3 survive a failure on clip 4
	 * and only clip 4 needs retrying.
	 *
	 * Goes through `videoSourceAuto`, NOT `videoSource`: anything over
	 * `CHUNKED_UPLOAD_THRESHOLD_BYTES` must be sent in parts or the edge 413s it
	 * (Cloudflare's 100 MB body ceiling), which is precisely the ~134 MB drone
	 * clip this step exists to accept. The picker never decides which transport
	 * runs — it just reports whatever progress comes back.
	 */
	async function pump() {
		if (pumping) return;
		pumping = true;
		try {
			for (;;) {
				const row = queue.find((r) => r.status === 'queued');
				if (!row || !projectId) break;
				setStatus(row.key, 'uploading', '');
				setProgress(row.key, 0);
				const controller = new AbortController();
				controllers[row.key] = controller;
				try {
					const created = await uploads.videoSourceAuto(projectId, row.file, {
						onProgress: (fraction) => setProgress(row.key, fraction),
						signal: controller.signal
					});
					sources = [...sources, created];
					// Drop the row: the clip now lives in the server list, and showing it
					// twice would double-count the running total.
					queue = queue.filter((r) => r.key !== row.key);
				} catch (err) {
					// A cancel is not a failure and must not read like one: the operator
					// already knows why it stopped, and telling them the clip "could not be
					// uploaded" invites them to retry something they deliberately stopped.
					setStatus(
						row.key,
						'failed',
						cancelled.includes(row.key)
							? `Upload of ${row.file.name} was cancelled. Nothing was attached.`
							: uploadRowErrorMessage(err, row.file.name)
					);
				} finally {
					delete controllers[row.key];
				}
			}
		} finally {
			pumping = false;
		}
	}

	/**
	 * Stop an in-flight upload.
	 *
	 * There was no way to do this at all: a mis-picked 512 MB file could only be
	 * escaped by closing the tab, and the pump is SEQUENTIAL, so that one clip also
	 * blocked every clip queued behind it. The abort propagates through
	 * `videoSourceAuto` into the session create, the part PUTs and `complete`; the
	 * staged parts are released by the uploader itself, but ONLY while it is still
	 * staging — once `complete` has gone out the parts may already be a composed,
	 * probed, attached clip, so nothing here may delete them.
	 */
	function cancel(key: string) {
		const controller = controllers[key];
		if (!controller) return;
		if (!cancelled.includes(key)) cancelled = [...cancelled, key];
		controller.abort(new Error('The upload was cancelled.'));
	}

	function setStatus(key: string, status: QueueRow['status'], error: string) {
		queue = queue.map((r) => (r.key === key ? { ...r, status, error } : r));
	}

	function setProgress(key: string, progress: number) {
		queue = queue.map((r) => (r.key === key ? { ...r, progress } : r));
	}

	function retry(key: string) {
		// Clear the cancel mark first: without it a retried row would be labelled
		// "cancelled" again the moment any later failure landed on it.
		cancelled = cancelled.filter((k) => k !== key);
		setStatus(key, 'queued', '');
		setProgress(key, 0);
		void pump();
	}

	function discard(key: string) {
		cancel(key);
		cancelled = cancelled.filter((k) => k !== key);
		queue = queue.filter((r) => r.key !== key);
	}

	async function remove(source: VideoSourceResponse) {
		if (!projectId) return;
		removing = source.source_id;
		try {
			await uploads.deleteVideoSource(projectId, source.source_id);
			sources = sources.filter((s) => s.source_id !== source.source_id);
			listError = '';
		} catch (err) {
			listError = uploadSideErrorMessage(err, 'Could not remove the clip.');
		} finally {
			removing = null;
		}
	}
</script>

<div class="space-y-4">
	<div>
		<p
			id="video-sources-label"
			class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
		>
			Footage
		</p>
		<label
			class="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 hover:border-[var(--color-accent)] aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
			aria-disabled={!projectId}
		>
			{#if !projectId}
				<Loader class="h-5 w-5 animate-spin text-[var(--color-accent)]" />
				<span class="text-sm text-[var(--color-text-muted)]">Preparing your project…</span>
			{:else}
				<Upload class="h-5 w-5 text-[var(--color-text-muted)]" />
				<span class="text-sm text-[var(--color-text-muted)]">
					Add clips — .mp4, .mov, or .m4v, up to {formatFileSize(MAX_VIDEO_SOURCE_BYTES)} each
				</span>
			{/if}
			<input
				type="file"
				multiple
				accept={ACCEPT}
				class="sr-only"
				disabled={!projectId}
				data-testid="video-sources-input"
				aria-labelledby="video-sources-label"
				onchange={onPick}
			/>
		</label>
		<p class="mt-1 text-xs text-[var(--color-text-muted)]">
			Your own drone or camera footage. The pipeline probes every clip, then cuts them to the beat
			of the selected track — upload them in the order you want them considered.
		</p>
	</div>

	<!-- Live region: upload progress is otherwise invisible to a screen reader,
	     since it only shows as per-row icon changes. -->
	<p class="sr-only" role="status" aria-live="polite" data-testid="video-sources-announcer">
		{announcement}
	</p>

	{#if disabledReason}
		<p class="flex items-center gap-1 text-xs text-[var(--color-danger)]">
			<AlertCircle class="h-3.5 w-3.5 shrink-0" />
			{disabledReason}
		</p>
	{/if}
	{#if listError}
		<p class="flex items-center gap-1 text-xs text-[var(--color-danger)]">
			<AlertCircle class="h-3.5 w-3.5 shrink-0" />
			{listError}
		</p>
	{/if}

	{#if sources.length > 0 || queue.length > 0}
		<ul class="space-y-1.5" data-testid="video-sources-list">
			{#each sources as source (source.source_id)}
				<li
					class="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
					data-testid="video-source-row"
				>
					<Film class="h-4 w-4 shrink-0 text-[var(--color-success)]" />
					<span class="truncate text-sm text-[var(--color-text)]">{source.filename}</span>
					<span class="ml-auto shrink-0 text-xs text-[var(--color-text-muted)]">
						{formatFileSize(source.bytes)}
					</span>
					<button
						type="button"
						onclick={() => remove(source)}
						disabled={removing === source.source_id}
						aria-label={`Remove ${source.filename}`}
						class="shrink-0 rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text)] disabled:opacity-50"
					>
						{#if removing === source.source_id}
							<Loader class="h-4 w-4 animate-spin" />
						{:else}
							<Trash2 class="h-4 w-4" />
						{/if}
					</button>
				</li>
			{/each}
			{#each queue as row (row.key)}
				<li
					class="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
					data-testid="video-source-queue-row"
				>
					{#if row.status === 'uploading'}
						<Loader class="h-4 w-4 shrink-0 animate-spin text-[var(--color-accent)]" />
					{:else if row.status === 'failed'}
						<AlertCircle class="h-4 w-4 shrink-0 text-[var(--color-danger)]" />
					{:else}
						<Film class="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
					{/if}
					<span class="min-w-0">
						<span class="block truncate text-sm text-[var(--color-text)]">{row.file.name}</span>
						<span
							class="block text-xs {row.status === 'failed'
								? 'text-[var(--color-danger)]'
								: 'text-[var(--color-text-muted)]'}"
						>
							{row.status === 'failed'
								? row.error
								: row.status === 'uploading'
									? `Uploading… ${Math.round(row.progress * 100)}%`
									: 'Queued'}
						</span>
						{#if row.status === 'uploading'}
							<!-- A determinate bar, because a large clip is sent in parts and
							     a spinner alone cannot tell "moving slowly" from "wedged". -->
							<span
								class="mt-1 block h-1 w-full overflow-hidden rounded-full bg-[var(--color-border)]"
								role="progressbar"
								aria-label={`Uploading ${row.file.name}`}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={Math.round(row.progress * 100)}
								data-testid="video-source-progress"
							>
								<span
									class="block h-full bg-[var(--color-accent)] transition-[width] duration-200"
									style={`width: ${Math.round(row.progress * 100)}%`}
								></span>
							</span>
						{/if}
					</span>
					<span class="ml-auto shrink-0 text-xs text-[var(--color-text-muted)]">
						{formatFileSize(row.file.size)}
					</span>
					{#if row.status === 'uploading'}
						<!-- The ONLY escape from a mis-picked 512 MB file that is not
						     closing the tab. Sequential pump ⇒ this also unblocks every
						     clip queued behind it. -->
						<button
							type="button"
							onclick={() => cancel(row.key)}
							aria-label={`Cancel upload of ${row.file.name}`}
							data-testid="video-source-cancel"
							class="shrink-0 rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-text-muted)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
						>
							<X class="h-4 w-4" />
						</button>
					{/if}
					{#if row.status === 'failed'}
						<button
							type="button"
							onclick={() => retry(row.key)}
							aria-label={`Retry ${row.file.name}`}
							class="shrink-0 rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
						>
							<RotateCw class="h-4 w-4" />
						</button>
					{/if}
					{#if row.status !== 'uploading'}
						<button
							type="button"
							onclick={() => discard(row.key)}
							aria-label={`Remove ${row.file.name}`}
							class="shrink-0 rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					{/if}
				</li>
			{/each}
		</ul>
		<p class="text-xs text-[var(--color-text-muted)]" data-testid="video-sources-total">
			{sources.length} clip{sources.length === 1 ? '' : 's'} uploaded · {formatFileSize(totalBytes)}
			{#if pending.length > 0}· {pending.length} pending{/if}
		</p>
	{/if}

	{#if projectId && sources.length === 0 && pending.length === 0}
		<p class="text-xs text-[var(--color-danger)]" data-testid="video-sources-required">
			Upload at least one clip — an action reel is cut from your footage, so a run with no clips
			fails at the first stage.
		</p>
	{/if}
</div>
