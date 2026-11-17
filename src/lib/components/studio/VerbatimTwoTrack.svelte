<script lang="ts">
	import VerbatimItemList from './VerbatimItemList.svelte';
	import type {
		VerbatimItemCreateRequest,
		VerbatimItemResponse,
		VerbatimItemUpdateRequest,
		VerbatimScope
	} from '$lib/types';

	interface Props {
		items: VerbatimItemResponse[];
		defaultScope?: VerbatimScope;
		readOnly?: boolean;
		onCreate?: (body: VerbatimItemCreateRequest) => Promise<void>;
		onDelete?: (itemId: string) => Promise<void>;
		onUpdate?: (itemId: string, body: VerbatimItemUpdateRequest) => Promise<void>;
		/** -1 = up, +1 = down. Moves stay within the item's own track. */
		onMove?: (itemId: string, dir: -1 | 1) => Promise<void>;
		onPlacedClick?: (elementId: string) => void;
	}

	let {
		items,
		defaultScope = 'pipeline',
		readOnly = false,
		onCreate,
		onDelete,
		onUpdate,
		onMove,
		onPlacedClick
	}: Props = $props();

	// Split by kind so the two columns each render a kind-locked add-form. The
	// single underlying VerbatimItemCreateRequest still carries the kind, so
	// the two parents share one onCreate handler.
	//
	// Filter only — the render ORDER is the store's (getProjectList sorts by
	// position). Re-sorting here would fork the ordering rule in two places.
	let slideItems = $derived(items.filter((i) => i.kind === 'slide'));
	let ttsItems = $derived(items.filter((i) => i.kind === 'tts'));
</script>

<div class="grid gap-6 md:grid-cols-2">
	<!-- `data-track` carries the API `kind`, not the heading. The two are not the
	     same word: the narration column is headed "TTS verbatim" while users (and
	     the feature files) call that track "Narration". Binding on the attribute
	     keeps the Gherkin in the user's language without coupling it to copy. -->
	<section class="space-y-2" data-testid="verbatim-track" data-track="slide">
		<header>
			<h3 class="text-sm font-semibold text-[var(--color-text)]">Slide verbatim</h3>
			<p class="text-xs text-[var(--color-text-muted)]">
				Literal text the slide deck must surface.
			</p>
		</header>
		<VerbatimItemList
			items={slideItems}
			fixedKind="slide"
			{readOnly}
			{defaultScope}
			{onCreate}
			{onDelete}
			{onUpdate}
			{onMove}
			{onPlacedClick}
		/>
	</section>

	<section class="space-y-2" data-testid="verbatim-track" data-track="tts">
		<header>
			<h3 class="text-sm font-semibold text-[var(--color-text)]">TTS verbatim</h3>
			<p class="text-xs text-[var(--color-text-muted)]">Literal text the narrator must say.</p>
		</header>
		<VerbatimItemList
			items={ttsItems}
			fixedKind="tts"
			{readOnly}
			{defaultScope}
			{onCreate}
			{onDelete}
			{onUpdate}
			{onMove}
			{onPlacedClick}
		/>
	</section>
</div>
