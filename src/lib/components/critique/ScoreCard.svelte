<script lang="ts">
	import type { CritiqueCategory } from '$lib/types';
	import { Search, Accessibility, Shield, Zap, Eye } from '@lucide/svelte';

	let { category, score }: { category: CritiqueCategory; score: number | null } = $props();

	const icons: Record<CritiqueCategory, typeof Search> = {
		seo: Search,
		a11y: Accessibility,
		security: Shield,
		performance: Zap,
		ux: Eye
	};

	const labels: Record<CritiqueCategory, string> = {
		seo: 'SEO',
		a11y: 'Accessibility',
		security: 'Security',
		performance: 'Performance',
		ux: 'UX'
	};

	const scoreColor = $derived(
		score === null
			? 'text-text-muted'
			: score >= 80
				? 'text-status-completed'
				: score >= 60
					? 'text-status-pending'
					: 'text-status-failed'
	);

	const strokeColor = $derived(
		score === null
			? 'stroke-border'
			: score >= 80
				? 'stroke-status-completed'
				: score >= 60
					? 'stroke-status-pending'
					: 'stroke-status-failed'
	);

	const bgAccent = $derived(
		score === null
			? 'bg-surface-raised'
			: score >= 80
				? 'bg-status-completed/10'
				: score >= 60
					? 'bg-status-pending/10'
					: 'bg-status-failed/10'
	);

	// SVG circular gauge: radius 36, circumference ~226.2
	const circumference = 2 * Math.PI * 36;
	const dashOffset = $derived(
		score === null ? circumference : circumference - (score / 100) * circumference
	);

	const Icon = $derived(icons[category]);
</script>

<div
	class="flex flex-col items-center gap-2.5 p-4 bg-surface border border-border rounded-xl shadow-sm hover:shadow-md transition-shadow {bgAccent}"
>
	<div class="relative h-20 w-20">
		<svg class="h-20 w-20 -rotate-90" viewBox="0 0 80 80">
			<circle cx="40" cy="40" r="36" fill="none" stroke-width="5" class="stroke-border" />
			<circle
				cx="40"
				cy="40"
				r="36"
				fill="none"
				stroke-width="5"
				class="{strokeColor} transition-all duration-700 ease-out"
				stroke-linecap="round"
				stroke-dasharray={circumference}
				stroke-dashoffset={dashOffset}
			/>
		</svg>
		<div class="absolute inset-0 flex items-center justify-center">
			<span class="text-lg font-bold {scoreColor}">
				{score === null ? '--' : score.toFixed(0)}
			</span>
		</div>
	</div>
	<div class="flex items-center gap-1.5 text-sm font-medium text-text-secondary">
		<Icon class="h-4 w-4" />
		<span>{labels[category]}</span>
	</div>
</div>
