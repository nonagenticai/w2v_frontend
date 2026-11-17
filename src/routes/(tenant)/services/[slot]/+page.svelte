<script lang="ts">
	// Service test bench — one page per GPU slot (`/services/image`, `/services/tts`, …).
	// Real input → real output → history: the form, the request encoding and the
	// result renderer are all driven by `$lib/services/slots.ts`, so the slots
	// cannot drift from each other.
	//
	// Tenant-admin only via the `(tenant)` layout; no exemption is added here.
	// CSR-only: the loads run in an `$effect` (client), never in a server load.
	import { resolve } from '$app/paths';
	import { onMount, tick } from 'svelte';
	import { WandSparkles } from '@lucide/svelte';
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	import RunResult from '$lib/components/services/RunResult.svelte';
	import { Badge, Button, Card, EmptyState, ErrorState, Input, Skeleton } from '$lib/components/ui';
	import { providers, type SlotView } from '$lib/api/providers.js';
	import { providerRequirements, type SlotRequirement } from '$lib/api/provider-requirements.js';
	import { summaryRow } from '$lib/components/providers/provider-groups.js';
	import {
		HISTORY_LIMIT,
		providerLabel,
		runMediaUrl,
		runPrompt,
		serviceLab,
		serviceLabError,
		type ServiceLabError,
		type ServiceRun
	} from '$lib/api/serviceLab.js';
	import { formatDuration, formatRelativeTime } from '$lib/utils/format.js';
	import { toastError } from '$lib/stores/toast.svelte.js';
	import {
		SLOTS,
		isEnhanceTarget,
		missingRequirement,
		slotDescriptor,
		type SlotDescriptor,
		type SlotField,
		type SlotId
	} from '$lib/services/slots.js';

	let { data }: { data: { slot: SlotId } } = $props();

	/** The loader 404s an unknown slot; this fallback only keeps a bare render safe. */
	const descriptor = $derived(slotDescriptor(data.slot) ?? SLOTS[0]);

	// Field values are kept as the STRINGS the user typed. A `bind:value` on an
	// `<input type="number">` coerces to a number (Svelte's own rule), which then
	// blows up every `.trim()` here — so the controls write back strings and the
	// JSON body converts only the fields the descriptor marks as numbers.
	let values = $state<Record<string, string>>({});
	let files = $state<Record<string, File | null>>({});
	let running = $state(false);
	let enhancing = $state(false);
	let result = $state<ServiceRun | null>(null);
	let runError = $state<ServiceLabError | null>(null);
	let enhanceError = $state<ServiceLabError | null>(null);
	let history = $state<ServiceRun[]>([]);
	let historyLoading = $state(true);
	let historyError = $state<ServiceLabError | null>(null);
	let providerSlot = $state<SlotView | null>(null);
	let requirement = $state<SlotRequirement | undefined>(undefined);
	let providerStatus = $state<'loading' | 'ready' | 'error'>('loading');
	/** Elapsed-time ticker so a multi-minute video run never looks frozen. */
	let startedAt = $state<number | null>(null);
	let now = $state(Date.now());
	let loadedSlot = $state<SlotId | null>(null);
	let ticker: ReturnType<typeof setInterval> | null = null;

	function stopTicker(): void {
		if (ticker !== null) {
			clearInterval(ticker);
			ticker = null;
		}
	}
	onMount(() => () => stopTicker());

	const elapsedSeconds = $derived(
		startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000))
	);

	// One load per slot. SvelteKit reuses this component when only the `[slot]`
	// param changes, so the reset + reload is keyed on the descriptor id.
	$effect(() => {
		const d = descriptor;
		if (loadedSlot === d.id) return;
		// Seed before publishing the slot, so the first paint of the form already
		// has a string for every field (never `undefined`, which Svelte refuses to
		// bind to an Input whose `value` prop has a fallback).
		values = Object.fromEntries(
			d.fields.filter((field) => field.kind !== 'file').map((field) => [field.key, ''])
		);
		loadedSlot = d.id;
		files = {};
		result = null;
		runError = null;
		enhanceError = null;
		history = [];
		historyError = null;
		historyLoading = true;
		providerStatus = 'loading';
		void loadHistory(d);
		void loadProviderContext(d);
	});

	async function loadHistory(d: SlotDescriptor): Promise<void> {
		try {
			const page = await serviceLab.history(d.id, HISTORY_LIMIT);
			if (loadedSlot === d.id) history = page.items;
		} catch (e) {
			if (loadedSlot === d.id) {
				historyError = serviceLabError(e, { slot: d.id, fallback: "Couldn't load past runs." });
			}
		} finally {
			if (loadedSlot === d.id) historyLoading = false;
		}
	}

	// The provider chip is context, never a gate: if it cannot be read the page
	// still runs, because the run endpoints answer the same 402/409 truthfully.
	async function loadProviderContext(d: SlotDescriptor): Promise<void> {
		try {
			const [list, manifest] = await Promise.all([providers.list(), providerRequirements.get()]);
			if (loadedSlot !== d.id) return;
			requirement = manifest.slots.find((r) => r.slot === d.providerSlot);
			providerSlot = list.items.find((s) => s.slot === d.providerSlot) ?? null;
			providerStatus = 'ready';
		} catch {
			if (loadedSlot === d.id) providerStatus = 'error';
		}
	}

	const providerChip = $derived.by((): { text: string; requires: boolean } | null => {
		if (providerStatus !== 'ready') return null;
		const view = providerSlot;
		if (!view) return { text: 'No provider registered for this service', requires: true };
		if (view.source === 'tenant' && view.connection) {
			const row = summaryRow(view, requirement);
			return { text: `${row.sourceLabel} · ${row.model}`, requires: false };
		}
		if (view.byo_required) return { text: 'Requires your own provider', requires: true };
		const row = summaryRow(view, requirement);
		const text =
			row.model && row.model !== '—' ? `${row.sourceLabel} · ${row.model}` : row.sourceLabel;
		return { text, requires: false };
	});

	const valueOf = (key: string): string => (values[key] ?? '').trim();
	const hasValue = (key: string): boolean => valueOf(key) !== '' || !!files[key];
	const validation = $derived(missingRequirement(descriptor, hasValue));
	const canSubmit = $derived(!running && validation === null);
	const promptKey = $derived(descriptor.promptField ?? null);
	const promptValue = $derived(promptKey ? valueOf(promptKey) : '');
	const canEnhance = $derived(
		promptKey !== null &&
			isEnhanceTarget(descriptor.id) &&
			promptValue !== '' &&
			!enhancing &&
			!running
	);

	const historyRows = $derived(history.map((run) => ({ run, media: runMediaUrl(run) })));

	function placeholderFor(field: SlotField): string {
		if (field.placeholder) return field.placeholder;
		return field.key === descriptor.promptField ? descriptor.example : '';
	}

	function timingOf(run: ServiceRun): string {
		const parts = [formatRelativeTime(run.created_at)];
		// `!= null` (not `!== null`): the generated schema marks duration_ms
		// OPTIONAL, so the value is `number | null | undefined` and only the
		// loose form narrows both away.
		if (run.duration_ms != null) parts.push(formatDuration(run.duration_ms));
		return parts.join(' · ');
	}

	function setFile(key: string, file: File | null): void {
		files = { ...files, [key]: file };
	}

	/** The JSON body: only the fields the user filled in, numbers as numbers. */
	function jsonBody(d: SlotDescriptor): Record<string, unknown> {
		const body: Record<string, unknown> = {};
		for (const field of d.fields) {
			if (field.kind === 'file') continue;
			const raw = valueOf(field.key);
			if (!raw) continue;
			body[field.key] = field.kind === 'number' ? Number(raw) : raw;
		}
		return body;
	}

	/** The multipart body: the picked file(s) plus every filled text field. */
	function formBody(d: SlotDescriptor): FormData {
		const form = new FormData();
		for (const field of d.fields) {
			if (field.kind === 'file') {
				const file = files[field.key];
				if (file) form.append(field.key, file);
				continue;
			}
			const raw = valueOf(field.key);
			if (raw) form.append(field.key, raw);
		}
		return form;
	}

	async function submit(): Promise<void> {
		if (!canSubmit) return;
		const d = descriptor;
		running = true;
		runError = null;
		enhanceError = null;
		startedAt = Date.now();
		now = startedAt;
		stopTicker();
		ticker = setInterval(() => (now = Date.now()), 1000);
		try {
			const run =
				d.input === 'json'
					? await serviceLab.run(d.id, jsonBody(d))
					: await serviceLab.runForm(d.id, formBody(d));
			result = run;
			history = [run, ...history].slice(0, HISTORY_LIMIT);
		} catch (e) {
			// A refused run leaves no result: showing the previous player under a
			// "no renderer" error would claim an output that was never produced.
			result = null;
			runError = serviceLabError(e, { slot: d.id });
			toastError('The service call failed', runError.message);
		} finally {
			running = false;
			startedAt = null;
			stopTicker();
		}
	}

	// Rewrite the prompt in place. Never submits the run: the user reviews the
	// rewrite and presses the normal submit button themselves.
	async function enhancePrompt(): Promise<void> {
		const d = descriptor;
		const key = d.promptField;
		const target = d.id;
		if (!key || !isEnhanceTarget(target) || enhancing) return;
		const prompt = valueOf(key);
		if (!prompt) return;
		enhancing = true;
		enhanceError = null;
		try {
			const res = await serviceLab.enhance(prompt, target);
			values = { ...values, [key]: res.prompt };
		} catch (e) {
			const info = serviceLabError(e, {
				slot: target,
				fallback: 'Could not enhance the prompt.'
			});
			enhanceError = info;
			toastError('Prompt not enhanced', info.message);
		} finally {
			enhancing = false;
		}
	}

	async function openRun(id: string): Promise<void> {
		try {
			const run = await serviceLab.historyRun(descriptor.id, id);
			result = run;
			runError = null;
			// The result panel sits above the history, so bring it back into view
			// once Svelte has actually painted it.
			await tick();
			if (typeof document !== 'undefined') {
				document.getElementById('service-result')?.scrollIntoView?.({ block: 'start' });
			}
		} catch (e) {
			toastError('Could not open that run', serviceLabError(e, { slot: descriptor.id }).message);
		}
	}
</script>

<svelte:head>
	<title>{descriptor.label} - Studio</title>
</svelte:head>

{#snippet errorNotice(info: ServiceLabError, testid: string)}
	<div
		role="alert"
		class="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 p-4 text-sm"
		data-testid={testid}
		data-kind={info.kind}
	>
		<p class="text-[var(--color-text)]">{info.message}</p>
		{#if info.showProviders}
			<a
				class="text-xs font-medium underline underline-offset-2"
				href={resolve('/providers')}
				data-testid={`${testid}-providers`}>Open Providers</a
			>
		{/if}
	</div>
{/snippet}

<Page width="narrow" testid="service-lab">
	<PageHeader kicker="Workspace" title={descriptor.label} subtitle={descriptor.blurb}>
		{#snippet description()}
			<div class="flex flex-wrap items-center gap-2" data-testid="service-provider">
				{#if providerStatus === 'loading'}
					<span class="text-xs text-[var(--color-text-muted)]">Checking the provider…</span>
				{:else if providerStatus === 'error'}
					<span class="text-xs text-[var(--color-text-muted)]">Provider status unavailable.</span>
				{:else if providerChip}
					<Badge variant={providerChip.requires ? 'warning' : 'default'}>{providerChip.text}</Badge>
					{#if providerChip.requires}
						<a
							class="text-xs underline underline-offset-2"
							href={resolve('/providers')}
							data-testid="service-provider-link">Set up a provider</a
						>
					{/if}
				{/if}
			</div>
		{/snippet}
	</PageHeader>

	<nav aria-label="Service test bench" class="flex flex-wrap gap-2" data-testid="service-slots">
		{#each SLOTS as slot (slot.id)}
			<a
				href={resolve(`/services/${slot.id}`)}
				aria-current={slot.id === descriptor.id ? 'page' : undefined}
				class="rounded-full border px-3 py-1 text-xs {slot.id === descriptor.id
					? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 font-medium text-[var(--color-text)]'
					: 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)]'}"
				data-testid="service-slot-{slot.id}">{slot.label}</a
			>
		{/each}
	</nav>

	<!-- The descriptor form renders only once its field values are seeded (the
	     effect above), so no control is ever bound to `undefined`. -->
	{#if loadedSlot === descriptor.id}
		<div data-testid="service-form">
			<Card class="p-5">
				<form
					class="flex flex-col gap-4"
					onsubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					{#each descriptor.fields as field (field.key)}
						{#if field.kind === 'file'}
							<div class="flex flex-col gap-1.5">
								<label for={field.key} class="text-sm font-medium text-[var(--color-text-muted)]"
									>{field.label}</label
								>
								<input
									id={field.key}
									name={field.key}
									type="file"
									accept={field.accept}
									disabled={running || enhancing}
									onchange={(event) => setFile(field.key, event.currentTarget.files?.[0] ?? null)}
									class="text-sm text-[var(--color-text)]"
									data-testid="service-file-{field.key}"
								/>
								{#if files[field.key]}
									<p class="text-xs text-[var(--color-text-muted)]">
										Selected: {files[field.key]?.name}
									</p>
								{/if}
							</div>
						{:else if field.kind === 'textarea'}
							<div class="flex flex-col gap-1.5">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<label for={field.key} class="text-sm font-medium text-[var(--color-text-muted)]"
										>{field.label}</label
									>
									{#if field.key === descriptor.promptField && isEnhanceTarget(descriptor.id)}
										<span data-testid="enhance-prompt">
											<Button
												variant="secondary"
												size="sm"
												onclick={enhancePrompt}
												loading={enhancing}
												disabled={!canEnhance}
												aria-label="Enhance prompt"
											>
												<WandSparkles class="h-3.5 w-3.5" />
												Enhance
											</Button>
										</span>
									{/if}
								</div>
								<textarea
									id={field.key}
									name={field.key}
									bind:value={values[field.key]}
									required={field.required}
									maxlength={field.maxLength}
									disabled={running || enhancing}
									rows={4}
									placeholder={placeholderFor(field)}
									class="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] transition-all duration-200 placeholder:text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
								></textarea>
							</div>
						{:else}
							<Input
								name={field.key}
								label={field.label}
								type={field.kind === 'number' ? 'number' : field.kind === 'url' ? 'url' : 'text'}
								placeholder={placeholderFor(field)}
								required={field.required}
								disabled={running || enhancing}
								min={field.min?.toString()}
								max={field.max?.toString()}
								step={field.step?.toString()}
								value={values[field.key] ?? ''}
								oninput={(event) =>
									(values[field.key] = (event.currentTarget as HTMLInputElement).value)}
							/>
						{/if}
					{/each}

					<p class="text-xs text-[var(--color-text-muted)]" data-testid="service-example">
						Example: {descriptor.example}
					</p>

					{#if validation}
						<p class="text-xs text-[var(--color-danger)]" data-testid="service-validation">
							{validation}
						</p>
					{/if}

					<div class="flex flex-wrap items-center gap-3">
						<Button type="button" onclick={submit} loading={running} disabled={!canSubmit}>
							{running ? 'Working…' : descriptor.actionLabel}
						</Button>
						{#if running}
							<p class="text-sm text-[var(--color-text-muted)]" data-testid="service-elapsed">
								{elapsedSeconds > 0 ? `Working — ${elapsedSeconds}s elapsed` : 'Working…'}
							</p>
						{/if}
						{#if descriptor.id === 'video'}
							<p class="text-xs text-[var(--color-text-muted)]">
								A video run can take several minutes — the timer above keeps counting.
							</p>
						{/if}
					</div>
				</form>
			</Card>
		</div>
	{:else}
		<Card class="p-4"><Skeleton variant="text" count={4} height="2.25rem" /></Card>
	{/if}

	{#if enhanceError}
		{@render errorNotice(enhanceError, 'enhance-error')}
	{/if}

	{#if runError}
		{@render errorNotice(runError, 'service-error')}
	{/if}

	{#if result}
		<div id="service-result" data-testid="service-result">
			<Card class="p-5">
				<div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
					<h2 class="text-base font-semibold text-[var(--color-text)]">Result</h2>
					<span class="text-xs text-[var(--color-text-muted)]" data-testid="result-meta"
						>{timingOf(result)}</span
					>
				</div>
				<RunResult run={result} />
			</Card>
		</div>
	{/if}

	<section class="flex flex-col gap-3" data-testid="service-history">
		<div class="flex items-baseline justify-between gap-2">
			<h2 class="text-base font-semibold text-[var(--color-text)]">Previous runs</h2>
			<span class="text-xs text-[var(--color-text-muted)]">Newest first</span>
		</div>
		{#if historyLoading}
			<Card class="p-4"><Skeleton variant="text" count={3} height="1.5rem" /></Card>
		{:else if historyError}
			<ErrorState
				title="Couldn't load past runs"
				error={historyError.message}
				onRetry={() => loadHistory(descriptor)}
			/>
		{:else if historyRows.length === 0}
			<Card class="p-0">
				<EmptyState
					title="No runs yet"
					description="Run the service once and the result appears here."
				/>
			</Card>
		{:else}
			<Card class="p-0">
				<ul class="divide-y divide-[var(--color-border)]">
					{#each historyRows as row (row.run.id)}
						<li class="flex flex-col gap-2 p-3" data-testid="history-row" data-slot={row.run.slot}>
							<button
								type="button"
								class="flex w-full items-start gap-3 text-left"
								onclick={() => void openRun(row.run.id)}
								aria-label={`Open ${descriptor.label} run from ${formatRelativeTime(row.run.created_at)}`}
								data-testid="history-open"
							>
								<span
									class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)]"
									data-testid="history-thumb"
								>
									{#if row.run.output_kind === 'image' && row.run.status === 'succeeded' && row.media}
										<img class="h-full w-full object-cover" src={row.media} alt="" />
									{:else}
										<span class="text-[10px] tracking-wide text-[var(--color-text-muted)] uppercase"
											>{row.run.output_kind ?? row.run.status}</span
										>
									{/if}
								</span>
								<span class="min-w-0 flex-1">
									<span
										class="block truncate text-sm text-[var(--color-text)]"
										data-testid="history-prompt">{runPrompt(row.run)}</span
									>
									<span
										class="mt-1 block text-xs text-[var(--color-text-muted)]"
										data-testid="history-meta"
										>{providerLabel(row.run.provider)} · {timingOf(row.run)}</span
									>
								</span>
							</button>
							{#if row.run.output_kind === 'audio' && row.run.status === 'succeeded' && row.media}
								<audio
									class="w-full"
									controls
									preload="none"
									src={row.media}
									data-testid="history-audio"
								>
									<track kind="captions" />
								</audio>
							{:else if row.run.output_kind === 'video' && row.run.status === 'succeeded' && row.media}
								<video
									class="w-48 rounded-[var(--radius-md)] border border-[var(--color-border)]"
									controls
									preload="none"
									src={row.media}
									data-testid="history-video"
								>
									<track kind="captions" />
								</video>
							{/if}
						</li>
					{/each}
				</ul>
			</Card>
		{/if}
	</section>
</Page>
