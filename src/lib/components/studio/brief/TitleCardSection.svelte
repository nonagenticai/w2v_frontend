<script lang="ts">
	import type { ProjectBrief } from '$lib/types';

	let {
		brief = $bindable<ProjectBrief>({})
	}: {
		brief?: ProjectBrief;
	} = $props();

	// Opt-in animated intro/outro title card. Writes a TRUTHY block
	// brief.title_card = { enabled: true, intro: true, outro: true }; run_setup
	// lifts it only when truthy and the compile tail renders an animated_title_card
	// clip spliced at the front/back of the video (soft-fail keeps the video
	// card-less). Off → drop the key so the presence/enabled check sees it absent.
	const titleCardEnabled = $derived(
		!!(
			brief.title_card &&
			typeof brief.title_card === 'object' &&
			(brief.title_card as Record<string, unknown>).enabled
		)
	);
	function setTitleCard(enabled: boolean) {
		if (enabled) {
			brief = { ...brief, title_card: { enabled: true, intro: true, outro: true } };
		} else {
			const { title_card: _drop, ...rest } = brief;
			brief = rest;
		}
	}
</script>

<!-- Animated title-card opt-in (promo / website_review / course / generic).
     Writes brief.title_card = { enabled, intro, outro }; the orchestrator
     compile tail renders a branded animated intro + outro and splices them
     around the video. Soft-fail — a render error just omits the card. -->
<label
	class="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 cursor-pointer"
>
	<input
		type="checkbox"
		data-testid="title-card-toggle"
		checked={titleCardEnabled}
		onchange={(e) => setTitleCard((e.currentTarget as HTMLInputElement).checked)}
		class="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]"
	/>
	<span>
		<span class="block text-sm font-medium text-[var(--color-text-muted)]">
			Animated intro/outro title card
		</span>
		<span class="mt-1 block text-xs text-[var(--color-text-muted)]">
			Open and close the video with a short branded title card animated from your brand colours.
			Soft-fail — a render error just leaves the card out.
		</span>
	</span>
</label>
