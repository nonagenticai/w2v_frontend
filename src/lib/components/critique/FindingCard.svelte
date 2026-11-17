<script lang="ts">
	import { safeHref } from '$lib/utils/safe-url';
	/* eslint-disable svelte/no-navigation-without-resolve -- finding.url is an external URL. */
	import type { CritiqueFinding } from '$lib/types';
	import SeverityBadge from './SeverityBadge.svelte';
	import { ChevronDown, Lightbulb, Code, ExternalLink } from '@lucide/svelte';

	let { finding }: { finding: CritiqueFinding } = $props();

	let expanded = $state(false);

	const categoryLabels: Record<string, string> = {
		seo: 'SEO',
		a11y: 'Accessibility',
		security: 'Security',
		performance: 'Performance',
		ux: 'UX'
	};
</script>

<div
	class="border border-border rounded-xl bg-surface overflow-hidden shadow-sm hover:shadow-md transition-shadow"
>
	<button
		type="button"
		onclick={() => (expanded = !expanded)}
		class="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-raised transition-colors"
	>
		<SeverityBadge severity={finding.severity} />
		<div class="flex-1 min-w-0">
			<p class="text-sm font-medium text-text truncate">{finding.title}</p>
			{#if finding.category}
				<p class="text-xs text-text-muted truncate">
					{categoryLabels[finding.category] ?? finding.category}
				</p>
			{/if}
		</div>
		<ChevronDown
			class="h-4 w-4 text-text-muted shrink-0 transition-transform duration-200 {expanded
				? 'rotate-180'
				: ''}"
		/>
	</button>

	{#if expanded}
		<div class="px-4 pb-4 pt-1 border-t border-border space-y-3">
			<!-- Description -->
			<div>
				<p class="text-xs font-medium text-text-muted mb-1">Description</p>
				<p class="text-sm text-text-secondary leading-relaxed">{finding.description}</p>
			</div>

			<!-- Recommendation -->
			{#if finding.recommendation}
				<div class="p-3 rounded-lg bg-primary-500/10 border border-primary-500/20">
					<div class="flex items-center gap-1.5 mb-1.5">
						<Lightbulb class="h-3.5 w-3.5 text-primary-400" />
						<p class="text-xs font-medium text-primary-400">Recommendation</p>
					</div>
					<p class="text-sm text-text-secondary leading-relaxed">{finding.recommendation}</p>
				</div>
			{/if}

			<!-- CSS Selector (evidence) -->
			{#if finding.selector}
				<div>
					<div class="flex items-center gap-1.5 mb-1.5">
						<Code class="h-3.5 w-3.5 text-text-muted" />
						<p class="text-xs font-medium text-text-muted">CSS Selector</p>
					</div>
					<code
						class="text-xs text-primary-400 bg-primary-500/10 border border-primary-500/20 px-2.5 py-1 rounded-md font-mono inline-block"
					>
						{finding.selector}
					</code>
				</div>
			{/if}

			<!-- URL -->
			{#if finding.url}
				<div>
					<div class="flex items-center gap-1.5 mb-1.5">
						<ExternalLink class="h-3.5 w-3.5 text-text-muted" />
						<p class="text-xs font-medium text-text-muted">URL</p>
					</div>
					<a
						href={safeHref(finding.url)}
						target="_blank"
						rel="noopener noreferrer"
						class="text-xs text-primary-400 hover:text-primary-300 font-mono break-all inline-flex items-center gap-1"
					>
						{finding.url}
						<ExternalLink class="h-3 w-3 shrink-0" />
					</a>
				</div>
			{/if}
		</div>
	{/if}
</div>
