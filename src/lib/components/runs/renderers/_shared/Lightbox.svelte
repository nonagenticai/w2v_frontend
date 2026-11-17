<script lang="ts">
	// Full-bleed media viewer with prev/next. Self-contained native <dialog>
	// (the shared ui/Dialog hardcodes a 640px inner wrapper, too small for media).
	// Escape + backdrop click close; ←/→ navigate. Reused by every gallery.
	import { X, ChevronLeft, ChevronRight } from '@lucide/svelte';
	import { scopedMediaUrl } from '$lib/api/client.js';

	export type LightboxItem = { url: string; kind: 'image' | 'video'; label?: string };

	let {
		items = [],
		open = $bindable(false),
		index = $bindable(0)
	}: { items: LightboxItem[]; open?: boolean; index?: number } = $props();

	let dialogEl = $state<HTMLDialogElement>();

	$effect(() => {
		if (!dialogEl) return;
		if (open && !dialogEl.open) dialogEl.showModal();
		if (!open && dialogEl.open) dialogEl.close();
	});

	const current = $derived(items[index]);
	// Every gallery feeds this one component, so the tenant switch is applied here
	// too — the <img>/<video> fetch is browser-initiated and can't send the
	// X-Active-Tenant-Id header. scopedMediaUrl is idempotent, so callers that
	// already scoped their items are unaffected.
	const currentUrl = $derived(scopedMediaUrl(current?.url));
	const many = $derived(items.length > 1);

	function prev() {
		if (items.length) index = (index - 1 + items.length) % items.length;
	}
	function next() {
		if (items.length) index = (index + 1) % items.length;
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') prev();
		else if (e.key === 'ArrowRight') next();
	}
</script>

<dialog
	bind:this={dialogEl}
	onclose={() => (open = false)}
	onkeydown={onKey}
	onclick={(e) => {
		if (e.target === dialogEl) open = false;
	}}
	class="m-auto max-h-[92vh] max-w-[92vw] bg-transparent p-0 text-[var(--color-text)] backdrop:bg-black/70"
>
	{#if current}
		<div class="relative flex flex-col items-center gap-2">
			<button
				type="button"
				aria-label="Close"
				onclick={() => (open = false)}
				class="absolute -top-1 right-0 z-10 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
			>
				<X class="h-5 w-5" />
			</button>
			{#if current.kind === 'video'}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					src={currentUrl}
					controls
					autoplay
					class="max-h-[88vh] max-w-[92vw] rounded-[var(--radius-md)] bg-black"
				></video>
			{:else}
				<img
					src={currentUrl}
					alt={current.label ?? 'preview'}
					class="max-h-[88vh] max-w-[92vw] rounded-[var(--radius-md)] object-contain"
				/>
			{/if}
			{#if current.label}
				<p class="text-sm text-white/90">{current.label}</p>
			{/if}
			{#if many}
				<button
					type="button"
					aria-label="Previous"
					onclick={prev}
					class="absolute left-0 top-1/2 -translate-x-full -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
				>
					<ChevronLeft class="h-6 w-6" />
				</button>
				<button
					type="button"
					aria-label="Next"
					onclick={next}
					class="absolute right-0 top-1/2 translate-x-full -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
				>
					<ChevronRight class="h-6 w-6" />
				</button>
			{/if}
		</div>
	{/if}
</dialog>
