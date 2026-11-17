<script lang="ts">
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	import { onDestroy } from 'svelte';
	import { ScoreDashboard, FindingsList, BackendSecuritySection } from '$lib/components/critique';
	import { Card, Spinner, Button } from '$lib/components/ui';
	import { formatRelativeTime, extractHostname, formatDuration } from '$lib/utils/format.js';
	import { toastError } from '$lib/stores/toast.svelte.js';
	import { critique, redesign, ApiError } from '$lib/api';
	import type { RedesignResult } from '$lib/types';
	import { downloads } from '$lib/api/downloads.js';
	import { ExternalLink, FileDown, Wand2, Download } from '@lucide/svelte';

	let { data } = $props();

	let pollOverride: typeof data.run | undefined = $state(undefined);
	let run = $derived(pollOverride ?? data.run);

	// Set when polling discovers the critique is no longer reachable under the
	// current session (404 = another workspace / deleted; 401/403 = session
	// lost). Stops the poll and switches the page to an "unavailable" state
	// instead of silently re-firing a doomed request every 5s.
	let accessError = $state<number | null>(null);
	const PERMANENT_STATUSES = new Set([401, 403, 404]);

	// Redesign follow-on state (critique-first: feeds findings into the redesign).
	let redesigning = $state(false);
	let redesignStatus = $state<string | null>(null);
	let redesignResult = $state<RedesignResult | undefined>(undefined);
	let redesignError = $state<string | null>(null);
	let downloadingVariant = $state<string | null>(null);

	let destroyed = false;
	onDestroy(() => {
		destroyed = true;
	});

	// Reset override + redesign state when load data changes (navigation to a
	// different critique).
	$effect(() => {
		void data.run;
		pollOverride = undefined;
		accessError = null;
		redesigning = false;
		redesignStatus = null;
		redesignResult = undefined;
		redesignError = null;
		downloadingVariant = null;
	});

	const POLL_INTERVAL_MS = 5000;
	const TERMINAL_STATUSES = new Set(['completed', 'failed']);
	const REDESIGN_TERMINAL = new Set(['completed', 'failed', 'cancelled', 'error']);
	const REDESIGN_MAX_POLLS = 120; // ~10 min at 5s

	// Poll for updates when status is pending or running
	$effect(() => {
		if (TERMINAL_STATUSES.has(run.status) || accessError !== null) return;

		const targetId = run.id;
		const interval = setInterval(async () => {
			try {
				const updated = await critique.get(targetId);
				// Drop stale responses: on /critique/A → /critique/B navigation
				// the polling effect re-runs and clears the old interval, but an
				// already-in-flight request from the previous run can still resolve
				// and would otherwise overwrite the new run's pollOverride.
				if (targetId !== run.id) return;
				pollOverride = updated;
			} catch (e) {
				if (targetId !== run.id) return;
				// A permanent 4xx will never resolve — stop polling and surface it
				// instead of hammering the endpoint while showing stale data.
				if (e instanceof ApiError && PERMANENT_STATUSES.has(e.status)) {
					accessError = e.status;
					clearInterval(interval);
					return;
				}
				// Transient error — keep the last known state and retry next tick.
			}
		}, POLL_INTERVAL_MS);

		return () => clearInterval(interval);
	});

	let downloading = $state(false);

	async function exportPDF() {
		downloading = true;
		try {
			// Routes through `downloads.critiqueReportPdf` so the request carries
			// the same Authorization (Keycloak JWT) + X-Tenant-Id (Bearer license
			// token) headers as every other API call. A bare `fetch()` skipped
			// those and was the static-review report's flagged regression.
			await downloads.critiqueReportPdf(run.id, `critique-report-${extractHostname(run.url)}.pdf`);
		} catch (err) {
			toastError('PDF export failed', err instanceof Error ? err.message : 'Unknown error');
		} finally {
			downloading = false;
		}
	}

	const duration = $derived.by(() => {
		if (!run.created_at || !run.completed_at) return null;
		return new Date(run.completed_at).getTime() - new Date(run.created_at).getTime();
	});

	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

	async function generateRedesign() {
		redesigning = true;
		redesignError = null;
		redesignResult = undefined;
		redesignStatus = 'pending';
		const critiqueRunId = run.id;
		try {
			const job = await redesign.create({ url: run.url, critique_findings: run.findings });
			let status = job.status;
			redesignStatus = status;
			for (let i = 0; i < REDESIGN_MAX_POLLS && !REDESIGN_TERMINAL.has(status); i++) {
				await sleep(POLL_INTERVAL_MS);
				// Bail if the user navigated to a different critique meanwhile.
				if (destroyed || run.id !== critiqueRunId) return;
				const polled = await redesign.get(job.job_id);
				status = polled.status;
				redesignStatus = status;
			}
			if (destroyed || run.id !== critiqueRunId) return;
			if (status === 'completed') {
				redesignResult = await redesign.result(job.job_id);
			} else if (REDESIGN_TERMINAL.has(status)) {
				redesignError = `Redesign ${status}.`;
			} else {
				redesignError = 'Redesign timed out. Try again later.';
			}
		} catch (err) {
			if (destroyed) return;
			redesignError = err instanceof Error ? err.message : 'Unknown error';
			toastError('Redesign failed', redesignError);
		} finally {
			if (!destroyed) redesigning = false;
		}
	}

	async function downloadVariant(style: string) {
		if (!redesignResult) return;
		downloadingVariant = style;
		try {
			const host = extractHostname(run.url);
			await downloads.redesignVariantHtml(
				redesignResult.job_id,
				style,
				`redesign-${host}-${style}.html`
			);
		} catch (err) {
			toastError('Download failed', err instanceof Error ? err.message : 'Unknown error');
		} finally {
			downloadingVariant = null;
		}
	}

	async function downloadPrimary() {
		if (!redesignResult) return;
		downloadingVariant = '__primary__';
		try {
			const host = extractHostname(run.url);
			await downloads.redesignHtml(redesignResult.job_id, `redesign-${host}.html`);
		} catch (err) {
			toastError('Download failed', err instanceof Error ? err.message : 'Unknown error');
		} finally {
			downloadingVariant = null;
		}
	}
</script>

<svelte:head>
	<title>Critique {extractHostname(run.url)} - Studio</title>
</svelte:head>

<Page testid="critique-detail">
	<PageHeader
		kicker="Critique"
		title={extractHostname(run.url)}
		back={{ href: '/critique', label: 'critiques' }}
	>
		{#snippet actions()}
			<span
				class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
        {run.status === 'completed'
					? 'bg-status-completed/15 text-status-completed'
					: run.status === 'running'
						? 'bg-status-running/15 text-status-running'
						: run.status === 'failed'
							? 'bg-status-failed/15 text-status-failed'
							: 'bg-status-pending/15 text-status-pending'}"
			>
				{run.status.charAt(0).toUpperCase() + run.status.slice(1)}
			</span>
			{#if run.status === 'completed'}
				<Button variant="secondary" size="sm" loading={downloading} onclick={exportPDF}>
					<FileDown class="h-4 w-4" />
					{downloading ? 'Generating PDF...' : 'Export PDF'}
				</Button>
			{/if}
		{/snippet}
	</PageHeader>

	<!-- URL -->
	<a
		href={run.url}
		target="_blank"
		rel="noopener noreferrer"
		class="flex items-center gap-2 text-sm text-primary-400 hover:text-primary-300 font-mono break-all"
	>
		{run.url}
		<ExternalLink class="h-3.5 w-3.5 shrink-0" />
	</a>

	{#if accessError !== null}
		<div
			role="alert"
			data-testid="critique-unavailable"
			class="rounded-lg border border-status-failed/30 bg-status-failed/10 px-4 py-3 text-sm text-status-failed"
		>
			Live updates stopped — this critique isn't available under your current workspace
			{accessError === 404
				? '(it may belong to a different workspace)'
				: '(your session may have expired)'}. The data below may be out of date; try reloading.
		</div>
	{/if}

	{#if run.status === 'pending' || run.status === 'running'}
		<Card class="p-8">
			<div class="flex flex-col items-center gap-3">
				<Spinner size="lg" />
				<p class="text-sm text-text-secondary">
					{run.status === 'pending' ? 'Waiting to start...' : 'Running critique analysis...'}
				</p>
			</div>
		</Card>
	{:else if run.status === 'failed'}
		<Card class="border-status-failed/50 bg-status-failed/10 p-5">
			<h3 class="text-sm font-semibold text-status-failed mb-1">Critique Failed</h3>
			<p class="text-sm text-text-secondary">{run.error_message ?? 'Unknown error'}</p>
		</Card>
	{:else}
		<!-- Scores -->
		<ScoreDashboard scores={run.scores} categories={run.categories} />

		<!-- Executive summary -->
		{#if run.summary}
			<Card class="p-5">
				<h2 class="text-sm font-semibold text-text mb-2">Executive Summary</h2>
				<p class="text-sm text-text-secondary leading-relaxed">{run.summary}</p>
			</Card>
		{/if}

		<!-- Findings -->
		{#if run.findings.length > 0}
			<div>
				<h2 class="text-sm font-semibold text-text mb-3">Findings ({run.findings.length})</h2>
				<FindingsList findings={run.findings} />
			</div>
		{/if}

		<!-- Backend Security -->
		<BackendSecuritySection {run} />

		<!-- Redesign follow-on -->
		<Card class="p-5">
			<div class="flex items-start justify-between gap-3">
				<div>
					<h2 class="text-sm font-semibold text-text">Redesign</h2>
					<p class="text-xs text-text-secondary mt-0.5">
						Generate redesigned page variants that address the findings above, then download the
						HTML.
					</p>
				</div>
				{#if !redesignResult}
					<Button
						variant="primary"
						size="sm"
						loading={redesigning}
						disabled={redesigning}
						onclick={generateRedesign}
					>
						<Wand2 class="h-4 w-4" />
						{redesigning ? 'Generating...' : 'Generate redesign'}
					</Button>
				{/if}
			</div>

			{#if redesigning}
				<div class="mt-4 flex items-center gap-3 text-sm text-text-secondary">
					<Spinner size="sm" />
					<span>Redesigning{redesignStatus ? ` (${redesignStatus})` : ''}...</span>
				</div>
			{:else if redesignError}
				<p class="mt-4 text-sm text-status-failed">{redesignError}</p>
			{:else if redesignResult}
				{#if redesignResult.variants && redesignResult.variants.length > 0}
					<div class="mt-4 space-y-2">
						{#each redesignResult.variants as v (v.variant_id)}
							<div
								class="flex items-center justify-between gap-4 px-3 py-2 bg-surface-raised border border-border rounded-lg"
							>
								<div class="min-w-0">
									<p class="text-sm font-medium text-text capitalize truncate">{v.style}</p>
									<p class="text-xs text-text-secondary">{v.status}</p>
								</div>
								<Button
									variant="secondary"
									size="sm"
									loading={downloadingVariant === v.style}
									disabled={v.status !== 'completed' || downloadingVariant !== null}
									onclick={() => downloadVariant(v.style)}
								>
									<Download class="h-4 w-4" />
									HTML
								</Button>
							</div>
						{/each}
					</div>
				{:else}
					<div class="mt-4 flex items-center justify-between gap-4">
						<p class="text-sm text-text-secondary capitalize">
							{redesignResult.style} redesign ready
						</p>
						<Button
							variant="secondary"
							size="sm"
							loading={downloadingVariant === '__primary__'}
							disabled={downloadingVariant !== null}
							onclick={downloadPrimary}
						>
							<Download class="h-4 w-4" />
							Download HTML
						</Button>
					</div>
				{/if}
			{/if}
		</Card>
	{/if}

	<!-- Metadata -->
	<Card class="p-5">
		<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
			<div>
				<p class="text-xs text-text-muted mb-1">Created</p>
				<p class="text-sm text-text">{formatRelativeTime(run.created_at)}</p>
			</div>
			<div>
				<p class="text-xs text-text-muted mb-1">Completed</p>
				<p class="text-sm text-text">
					{run.completed_at ? formatRelativeTime(run.completed_at) : '\u2014'}
				</p>
			</div>
			<div>
				<p class="text-xs text-text-muted mb-1">Duration</p>
				<p class="text-sm text-text">{duration !== null ? formatDuration(duration) : '\u2014'}</p>
			</div>
			<div>
				<p class="text-xs text-text-muted mb-1">Pages Scanned</p>
				<p class="text-sm text-text">{run.pages_scanned}</p>
			</div>
		</div>
	</Card>
</Page>
