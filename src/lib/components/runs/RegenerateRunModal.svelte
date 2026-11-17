<script lang="ts">
	import { Button, Dialog } from '$lib/components/ui';
	import { Play } from '@lucide/svelte';

	// `title` / `description` / `confirmLabel` let a caller that reaches a FULL
	// re-run from a narrower intent (e.g. the Studio's "Regenerate clip" on a
	// pipeline that cannot target one clip) say so in the same confirmation,
	// instead of inventing a second confirm pattern for the same money.
	let {
		open = $bindable(false),
		loading = false,
		onconfirm,
		title = 'Regenerate Run',
		description = 'Start a new version of this run? It is a new paid run: the steps that need to run again do, and finished steps they do not depend on are kept.',
		confirmLabel = 'Regenerate'
	}: {
		open?: boolean;
		loading?: boolean;
		onconfirm: () => void;
		title?: string;
		description?: string;
		confirmLabel?: string;
	} = $props();
</script>

<Dialog bind:open {title}>
	<p class="text-sm text-[var(--color-text-muted)]">
		{description}
	</p>
	<div class="flex justify-end gap-2 pt-2">
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" {loading} onclick={onconfirm}>
			<Play class="h-4 w-4" />
			{confirmLabel}
		</Button>
	</div>
</Dialog>
