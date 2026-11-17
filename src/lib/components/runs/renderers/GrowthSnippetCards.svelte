<script lang="ts">
	import { safeHref } from '$lib/utils/safe-url';
	// Growth bundle (GrowthBundleStageOutput.snippets[]{channel, text, cta_url})
	// → channel-branded marketing-copy cards with a one-click Copy and the CTA
	// link. The headline "ready to post" payoff of a run.
	import { Button } from '$lib/components/ui';
	import { Share2, MessageCircle, Mail, Globe, Copy, ExternalLink } from '@lucide/svelte';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte.js';
	import type { RendererProps } from './registry';
	import type { GrowthOutput, GrowthSnippet } from './stage-outputs';

	let { output }: RendererProps = $props();

	const data = $derived(output as unknown as GrowthOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const snippets = $derived<GrowthSnippet[]>(Array.isArray(data.snippets) ? data.snippets : []);

	const channelMeta = (ch?: string) => {
		switch ((ch ?? '').toLowerCase()) {
			case 'linkedin':
				return { icon: Share2, label: 'LinkedIn', tint: 'text-[#0a66c2]' };
			case 'twitter':
			case 'x':
				return { icon: MessageCircle, label: 'Twitter / X', tint: 'text-[var(--color-text)]' };
			case 'email':
				return { icon: Mail, label: 'Email', tint: 'text-[var(--color-text-muted)]' };
			case 'landing_page':
				return { icon: Globe, label: 'Landing page', tint: 'text-[var(--color-accent)]' };
			default:
				return { icon: Globe, label: ch ?? 'Channel', tint: 'text-[var(--color-text-muted)]' };
		}
	};

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toastSuccess('Copied to clipboard');
		} catch {
			toastError('Could not copy');
		}
	}
</script>

<div class="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="growth-snippets">
	{#each snippets as s, i (str(s.id) ?? i)}
		{@const meta = channelMeta(str(s.channel))}
		{@const Icon = meta.icon}
		{@const text = str(s.text) ?? ''}
		<div
			class="flex flex-col rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
		>
			<div class="mb-2 flex items-center justify-between">
				<span class="inline-flex items-center gap-1.5 text-sm font-medium {meta.tint}">
					<Icon class="h-4 w-4" />{meta.label}
				</span>
				<button
					type="button"
					onclick={() => copy(text)}
					class="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
				>
					<Copy class="h-3.5 w-3.5" />Copy
				</button>
			</div>
			<p class="flex-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text)]">
				{text}
			</p>
			{#if str(s.cta_url)}
				<div class="mt-2">
					<Button href={safeHref(s.cta_url)} variant="secondary" size="sm">
						<ExternalLink class="h-3.5 w-3.5" /> Open CTA
					</Button>
				</div>
			{/if}
		</div>
	{/each}
</div>
