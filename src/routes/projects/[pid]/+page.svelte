<script lang="ts">
	import { ProjectWorkspace } from '$lib/components/workspace';
	import { subscribeProjectEvents } from '$lib/stores/projects-events';
	import { getOne } from '$lib/stores/projects.svelte.js';
	import { page } from '$app/state';
	import { BYO_REQUIRED_QUERY, byoProviderRequiredFromQuery } from '$lib/api/byo-provider.js';
	import ByoProviderRequiredNotice from '$lib/components/providers/ByoProviderRequiredNotice.svelte';

	let { data } = $props();

	// Read from the store (seeded by +page.ts:load → projects.loadOne) so that
	// SSE child-lifecycle events AND local mutations (addChild / reorderChildren
	// / update) flow into the rendered workspace. Falls back to the loader
	// snapshot during the brief window before the store entry populates.
	const project = $derived(getOne(data.project.id) ?? data.project);

	// Set by the create wizard when the project was created but its first run was
	// refused with 402 byo_provider_required (w2v_orchestrator#1108).
	const byoRequired = $derived(
		byoProviderRequiredFromQuery(page.url.searchParams.get(BYO_REQUIRED_QUERY))
	);

	// Subscribe to BE child-lifecycle SSE so add-child / reorder / status changes
	// from other tabs flow into the projects-store cache without a refetch.
	$effect(() => {
		const handle = subscribeProjectEvents(data.project.id);
		return () => handle.close();
	});
</script>

<svelte:head>
	<title>{project.title} - Studio</title>
</svelte:head>

{#if byoRequired}
	<div class="mb-4"><ByoProviderRequiredNotice required={byoRequired} /></div>
{/if}
<ProjectWorkspace {project} blueprintStages={data.blueprintStages} />
