<script lang="ts">
	import { Button, Dialog } from '$lib/components/ui';

	let {
		open = $bindable(false),
		loading = false,
		onconfirm
	}: {
		open?: boolean;
		loading?: boolean;
		onconfirm: () => void;
	} = $props();
</script>

<Dialog bind:open title="Cancel Pipeline">
	<p class="text-sm text-[var(--color-text-muted)]">
		Cancel this pipeline job? This action cannot be undone. Any in-progress stages will be stopped.
	</p>
	<div class="flex justify-end gap-2 pt-2">
		<Button variant="secondary" onclick={() => (open = false)}>Keep Running</Button>
		<Button variant="danger" {loading} onclick={onconfirm}>Cancel Pipeline</Button>
	</div>
</Dialog>
