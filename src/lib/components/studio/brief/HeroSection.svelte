<script lang="ts">
	import type { ProjectBrief } from '$lib/types';

	let {
		brief = $bindable<ProjectBrief>({})
	}: {
		brief?: ProjectBrief;
	} = $props();

	// website_review / web_design: opt-in animated hero. Writes
	// brief.redesign_motion = true; the redesign / web_design stage records a
	// deterministic scroll-through clip of the generated page and attaches it to
	// the hero visual (soft-fail keeps the static screenshot). Off → drop the key
	// (the stage's `if brief.redesign_motion` presence check sees it absent).
	const redesignMotionEnabled = $derived(brief.redesign_motion === true);
	function setRedesignMotion(enabled: boolean) {
		if (enabled) {
			brief = { ...brief, redesign_motion: true };
		} else {
			const { redesign_motion: _drop, ...rest } = brief;
			brief = rest;
		}
	}
</script>

<!-- Animated hero opt-in (website_review / web_design). Writes
     brief.redesign_motion; the redesign / web_design stage records a
     deterministic scroll-through clip of the generated page and attaches it
     to the hero visual. Soft-fail keeps the static screenshot. -->
<label
	class="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 cursor-pointer"
>
	<input
		type="checkbox"
		data-testid="redesign-motion-toggle"
		checked={redesignMotionEnabled}
		onchange={(e) => setRedesignMotion((e.currentTarget as HTMLInputElement).checked)}
		class="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]"
	/>
	<span>
		<span class="block text-sm font-medium text-[var(--color-text-muted)]"> Animated hero </span>
		<span class="mt-1 block text-xs text-[var(--color-text-muted)]">
			Add a deterministic scroll-through motion clip of the generated page to the hero visual.
			Soft-fail — the static screenshot is always kept.
		</span>
	</span>
</label>
