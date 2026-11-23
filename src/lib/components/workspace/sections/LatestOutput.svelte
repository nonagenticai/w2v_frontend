<script lang="ts">
	import { resolve } from '$app/paths';
	import { runs as runsApi } from '$lib/api';
	import RunOutputPanel from '$lib/components/runs/RunOutputPanel.svelte';
	import { PanelBoundary } from '$lib/components/errors';
	import { Skeleton } from '$lib/components/ui';
	import type { RunDetail, RunSummary } from '$lib/types/runs';
	import { formatRelativeTime } from '$lib/utils/format';
	import { downloadBaseName, videoTitleFor } from '$lib/utils/output-labels';
	import { ChevronRight } from '@lucide/svelte';

	// The project's most recent finished deliverable, ON the project page — the
	// video itself (play, download, captions, copy link), not a text link to a run
	// page where it sat below the setup panels. One run-detail read (~50 KB at
	// p90) for the newest completed run only.
	let {
		projectId,
		projectTitle,
		projectType,
		run
	}: {
		projectId: string;
		projectTitle: string;
		projectType: string;
		run: RunSummary;
	} = $props();

	let detail = $state<RunDetail | null>(null);
	let failed = $state(false);
	let loadedFor: string | null = null;

	$effect(() => {
		const id = run.id;
		if (loadedFor === id) return;
		loadedFor = id;
		detail = null;
		failed = false;
		Promise.resolve()
			.then(() => runsApi.get(id))
			.then((d) => {
				if (loadedFor === id) detail = d;
			})
			.catch(() => {
				if (loadedFor === id) failed = true;
			});
	});

	// What "Copy link" hands a teammate: the run page's absolute address.
	const shareUrl = $derived(
		typeof window === 'undefined'
			? undefined
			: `${window.location.origin}${resolve(`/projects/${projectId}/runs/${run.id}`)}`
	);
</script>

<div class="mt-4 space-y-3" data-testid="latest-output">
	<div class="flex items-center justify-between gap-3 flex-wrap">
		<h2 class="text-sm font-semibold text-[var(--color-text)]">
			Latest output
			{#if run.completed_at}
				<span class="ml-1 text-xs font-normal text-[var(--color-text-muted)]">
					finished {formatRelativeTime(run.completed_at)}
				</span>
			{/if}
		</h2>
		<a
			href={resolve(`/projects/${projectId}/runs/${run.id}`)}
			class="inline-flex items-center gap-1.5 text-sm text-[var(--color-accent)] hover:underline"
			data-testid="overview-latest-output"
		>
			Open the full run
			<ChevronRight class="h-4 w-4" />
		</a>
	</div>
	{#if failed}
		<p class="text-xs text-[var(--color-text-muted)]" data-testid="latest-output-error">
			The output could not be loaded here. Open the run to see it.
		</p>
	{:else if !detail}
		<div data-testid="latest-output-loading">
			<Skeleton variant="box" height="12rem" />
		</div>
	{:else}
		<PanelBoundary name="Latest output">
			<RunOutputPanel
				run={detail}
				videoTitle={videoTitleFor(projectType)}
				downloadBaseName={downloadBaseName(projectTitle)}
				{shareUrl}
				headingLevel={3}
			/>
		</PanelBoundary>
	{/if}
</div>
