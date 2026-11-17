<script lang="ts">
	// A REACTIVE parent for AuthSection's bindable brief: the plain getter/setter
	// binding in BriefForm.test.ts never re-renders the form after an edit, so the
	// messages that appear on change need this.
	import { untrack } from 'svelte';
	import AuthSection from './AuthSection.svelte';
	import type { ProjectBrief } from '$lib/types';

	let { initial, onbrief }: { initial: ProjectBrief; onbrief: (b: ProjectBrief) => void } =
		$props();
	let brief = $state<ProjectBrief>(
		untrack(() => structuredClone($state.snapshot(initial) as ProjectBrief))
	);
	$effect(() => onbrief($state.snapshot(brief) as ProjectBrief));
</script>

<AuthSection type="promo" bind:brief />
