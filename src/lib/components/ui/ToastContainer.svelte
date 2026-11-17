<script lang="ts">
	import Toast from './Toast.svelte';
	import { getToasts } from '$lib/stores/toast.svelte';
</script>

{#if getToasts().length > 0}
	<div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
		{#each getToasts() as toast (toast.id)}
			<Toast {toast} />
		{/each}
	</div>
{/if}
