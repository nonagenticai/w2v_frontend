<script lang="ts">
	import type { ProjectBrief } from '$lib/types';

	let {
		brief = $bindable<ProjectBrief>({})
	}: {
		brief?: ProjectBrief;
	} = $props();

	// Ken Burns: the compile tail animates each bare still shot (AI/curated image,
	// slide PNG) into a gentle pan/zoom clip, instead of holding one frozen frame.
	//
	// ON BY DEFAULT since orchestrator #836. `apply_ken_burns` used to require a
	// truthy `enabled`, but NOTHING in the product ever wrote that block (the A0
	// planner never resolved it, `to_brief_patch` skips empty dicts, gitops never
	// set it), so the gate was unreachable and every still-based film shipped as
	// frozen single frames. An ABSENT block now means ENABLED.
	//
	// So OFF must write an EXPLICIT `{ enabled: false }`. Dropping the key — what
	// this did before — now means "no opinion", which the backend reads as ON: the
	// checkbox would render unchecked and the film would pan anyway. Only an
	// explicitly falsy `enabled` opts out.
	//
	// Default (untouched brief, no key) is therefore CHECKED, matching what the
	// pipeline will actually do.
	const kenBurnsEnabled = $derived(
		brief.ken_burns && typeof brief.ken_burns === 'object'
			? (brief.ken_burns as Record<string, unknown>).enabled !== false
			: true
	);
	function setKenBurns(enabled: boolean) {
		brief = { ...brief, ken_burns: { enabled } };
	}
</script>

<!-- Ken Burns (promo / generic / course), ON BY DEFAULT. Always writes an
     EXPLICIT brief.ken_burns = { enabled }; the orchestrator compile tail
     animates each bare still shot into a gentle pan/zoom clip. Soft-fail — a
     render error keeps the still. Unchecking MUST write `enabled: false`:
     dropping the key reads as ON downstream (orchestrator #836). -->
<label
	class="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 cursor-pointer"
>
	<input
		type="checkbox"
		data-testid="ken-burns-toggle"
		checked={kenBurnsEnabled}
		onchange={(e) => setKenBurns((e.currentTarget as HTMLInputElement).checked)}
		class="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]"
	/>
	<span>
		<span class="block text-sm font-medium text-[var(--color-text-muted)]">
			Ken Burns motion on still images
		</span>
		<span class="mt-1 block text-xs text-[var(--color-text-muted)]">
			Gently pan and zoom still images and slides instead of holding them static. Soft-fail — a
			render error just keeps the still.
		</span>
	</span>
</label>
