<script lang="ts">
	import { safeHref } from '$lib/utils/safe-url';
	/* eslint-disable svelte/no-navigation-without-resolve -- external GitHub repo URL, not an internal route. */
	import type { CritiqueResponse } from '$lib/types';
	import { FindingsList } from '$lib/components/critique';
	import { Card } from '$lib/components/ui';
	import { Code, ExternalLink, ShieldCheck } from '@lucide/svelte';

	let { run }: { run: CritiqueResponse } = $props();

	// `findings` is declared non-optional but can be absent on a partial /
	// failed-to-load critique payload — guard so the editor doesn't white-screen.
	const backendFindings = $derived(
		(run.findings ?? []).filter((f) => f.finding_id?.startsWith('cgh-'))
	);
</script>

{#if run.github_repo_url || backendFindings.length > 0}
	<div class="space-y-3">
		<div class="flex items-center gap-2">
			<Code class="h-5 w-5 text-primary-400" />
			<h2 class="text-lg font-semibold text-text">Backend Code Security</h2>
		</div>

		<Card class="p-5 space-y-4">
			{#if run.github_repo_url}
				<div class="flex items-center gap-2 flex-wrap">
					<p class="text-xs text-text-muted">Repository:</p>
					<a
						href={safeHref(run.github_repo_url)}
						target="_blank"
						rel="noopener noreferrer"
						class="text-xs text-primary-400 hover:text-primary-300 font-mono flex items-center gap-1 break-all"
					>
						{run.github_repo_url}
						<ExternalLink class="h-3 w-3 shrink-0" />
					</a>
					{#if run.repo_detection_confidence}
						<span
							class="px-2 py-0.5 rounded-full text-[10px] font-medium border
              {run.repo_detection_confidence === 'high'
								? 'bg-status-completed/10 text-status-completed border-status-completed/20'
								: run.repo_detection_confidence === 'medium'
									? 'bg-status-running/10 text-status-running border-status-running/20'
									: 'bg-surface-raised text-text-secondary border-border'}"
						>
							{run.repo_detection_confidence} confidence
						</span>
					{/if}
				</div>
			{/if}

			{#if backendFindings.length > 0}
				<div>
					<p class="text-xs text-text-muted mb-3">
						Found {backendFindings.length} backend security issue{backendFindings.length !== 1
							? 's'
							: ''}
					</p>
					<FindingsList findings={backendFindings} />
				</div>
			{:else if run.github_repo_url}
				<div class="flex items-center gap-2 py-2">
					<ShieldCheck class="h-5 w-5 text-status-completed" />
					<p class="text-sm font-medium text-status-completed">No backend security issues found.</p>
				</div>
			{/if}
		</Card>
	</div>
{/if}
