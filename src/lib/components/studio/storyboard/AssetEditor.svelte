<script lang="ts">
	// Create/edit one storyboard asset: identity (kind/name/canonical_descriptor)
	// plus the consistency controls — reference images (the "moodboard"), `seed`
	// and `style_token`. `lora_path` and `attributes` remain unsurfaced; nothing
	// in the render path consumes them yet.
	//
	// WHAT THESE ACTUALLY DO — do not oversell them in the UI copy:
	// The image backend is FLUX schnell via mflux, which is text-to-image + seed
	// ONLY. There is no img2img, no ControlNet, no IP-Adapter, no reference-image
	// conditioning of any kind. So the reference images are NOT fed to the model;
	// they are human direction — what the author is aiming at, visible next to the
	// descriptor when writing or reviewing. The levers that genuinely move pixels
	// today are (a) the canonical descriptor, which is prepended to every shot
	// prompt referencing this asset, and (b) a pinned `seed`, which makes the
	// sampler deterministic so the same descriptor lands on the same face/space
	// across shots. `style_token` is a short tag carried into the prompt to keep
	// one asset's look nameable and stable. If reference-image conditioning ever
	// lands backend-side, this control is already the place it plugs in.
	//
	// Mirrors the StoryboardPanelCard field idiom (Input/Select from
	// $lib/components/ui, shared textarea class). Save routes to createAsset (no
	// asset) or updateAsset (existing asset.id) on the storyboard store, toasts
	// the outcome, and calls onDone so the parent can collapse the editor.
	import { untrack } from 'svelte';
	import type {
		StoryboardAssetResponse,
		StoryboardAssetCreate,
		StoryboardAssetUpdate,
		AssetKind
	} from '$lib/types';
	import { Input, Select } from '$lib/components/ui';
	import { uploads } from '$lib/api';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import { withUniqueKeys } from '$lib/utils/unique-keys.js';
	import { X } from '@lucide/svelte';
	import { createAsset, updateAsset } from '$lib/stores/storyboard.svelte.js';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte.js';

	interface Props {
		projectId: string;
		asset?: StoryboardAssetResponse;
		kind: AssetKind;
		onDone?: () => void;
	}

	let { projectId, asset, kind, onDone }: Props = $props();

	const KIND_OPTIONS: Array<{ value: AssetKind; label: string }> = [
		{ value: 'character', label: 'Character' },
		{ value: 'location', label: 'Location' },
		{ value: 'prop', label: 'Prop' }
	];

	// Seeded once from props (the component is re-mounted per add/edit, so the
	// initial-value capture is intentional); the form owns its draft state after.
	// untrack signals the seed-once intent and silences state_referenced_locally.
	let name = $state(untrack(() => asset?.name ?? ''));
	let selectedKind = $state<AssetKind>(untrack(() => asset?.kind ?? kind));
	let descriptor = $state(untrack(() => asset?.canonical_descriptor ?? ''));
	// Same seed-once contract as the fields above. `reference_images` is a plain
	// array on the response; copy it so editing the draft never mutates the store.
	let referenceImages = $state<string[]>(untrack(() => [...(asset?.reference_images ?? [])]));
	// Seed is held as a STRING while editing: an empty box has to stay
	// distinguishable from a deliberate 0, and a half-typed value must not
	// round-trip through NaN. Parsed (and validated) once, at save.
	let seedText = $state(untrack(() => (asset?.seed == null ? '' : String(asset.seed))));
	let styleToken = $state(untrack(() => asset?.style_token ?? ''));
	let saving = $state(false);
	let uploading = $state(false);

	const uid = $derived(asset?.id ?? 'new');
	const saveDisabled = $derived(name.trim() === '' || saving || uploading);

	// Upload one picked file and append the stored URL. A failure is toasted and
	// appends NOTHING — a silently-dropped image would read as "saved" and the
	// author would ship an asset whose moodboard is missing a reference.
	async function addReferenceImage(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		uploading = true;
		try {
			const res = await uploads.storyboardAssetImage(file);
			// De-duped: the backend keys stored images by content, so re-picking the
			// same file returns the SAME url — and the thumbnail strip is a keyed
			// each block, which throws outright on a duplicate key. Already-attached
			// is already the desired state, so this is a no-op, not a dropped image.
			referenceImages = referenceImages.includes(res.image_url)
				? referenceImages
				: [...referenceImages, res.image_url];
		} catch (e) {
			toastError('Failed to upload reference image', e instanceof Error ? e.message : undefined);
		} finally {
			uploading = false;
			// Let the same file be picked again after a failure.
			input.value = '';
		}
	}

	function removeReferenceImage(url: string) {
		referenceImages = referenceImages.filter((u) => u !== url);
	}

	// `null` clears the column; a bad number is refused loudly rather than
	// quietly becoming `null` (which would read as "seed intentionally unpinned").
	function parseSeed(): number | null | 'invalid' {
		const raw = seedText.trim();
		if (raw === '') return null;
		const n = Number(raw);
		if (!Number.isInteger(n) || n < 0) return 'invalid';
		return n;
	}

	const textareaClass =
		'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20';

	async function save() {
		if (saveDisabled) return;
		const seed = parseSeed();
		if (seed === 'invalid') {
			toastError('Seed must be a whole number', 'Leave it empty to let each render pick its own.');
			return;
		}
		saving = true;
		const descr = descriptor.trim() === '' ? null : descriptor;
		const token = styleToken.trim() === '' ? null : styleToken.trim();
		try {
			if (asset) {
				const body: StoryboardAssetUpdate = {
					kind: selectedKind,
					name: name.trim(),
					canonical_descriptor: descr,
					reference_images: referenceImages,
					seed,
					style_token: token
				};
				await updateAsset(projectId, asset.id, body);
				toastSuccess('Asset updated', name.trim());
			} else {
				const body: StoryboardAssetCreate = {
					kind: selectedKind,
					name: name.trim(),
					canonical_descriptor: descr,
					reference_images: referenceImages,
					seed,
					style_token: token
				};
				await createAsset(projectId, body);
				toastSuccess('Asset created', name.trim());
			}
			onDone?.();
		} catch (e) {
			toastError(
				asset ? 'Failed to update asset' : 'Failed to create asset',
				e instanceof Error ? e.message : undefined
			);
		} finally {
			saving = false;
		}
	}

	function cancel() {
		onDone?.();
	}
</script>

<div
	class="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
	data-testid="asset-editor"
>
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<Select
			label="Kind"
			name={`asset-kind-${uid}`}
			value={selectedKind}
			options={KIND_OPTIONS}
			placeholder=""
			disabled={saving}
			onchange={(e) => (selectedKind = (e.target as HTMLSelectElement).value as AssetKind)}
		/>
		<Input label="Name" name={`asset-name-${uid}`} required disabled={saving} bind:value={name} />
	</div>

	<div class="flex flex-col gap-1.5">
		<label
			for={`asset-descriptor-${uid}`}
			class="text-sm font-medium text-[var(--color-text-muted)]"
		>
			Canonical descriptor
		</label>
		<textarea
			id={`asset-descriptor-${uid}`}
			name={`asset-descriptor-${uid}`}
			rows="3"
			disabled={saving}
			class={textareaClass}
			placeholder="Identity and style prompt used to keep this asset consistent across shots."
			bind:value={descriptor}></textarea>
	</div>

	<!-- Reference images. Deliberately labelled "reference" and not "style
	     transfer": the renderer never sees these files (see the header comment).
	     They travel with the asset so a human writing or reviewing a shot can see
	     what this character/location is supposed to look like. -->
	<div class="flex flex-col gap-1.5" data-testid="asset-reference-images">
		<label
			for={`asset-reference-add-${uid}`}
			class="text-sm font-medium text-[var(--color-text-muted)]"
		>
			Reference images
		</label>
		<p class="text-xs text-[var(--color-text-muted)]">
			Visual direction for whoever writes the shots. The image model does not read them — the
			descriptor and seed below are what actually hold the look steady.
		</p>

		{#if referenceImages.length > 0}
			<ul class="flex flex-wrap gap-2 py-1">
				<!-- Keyed on the URL itself: `referenceImages` is a stored, unfiltered
				     array, so the same URL pasted twice (or two empty entries) throws
				     each_key_duplicate and blanks the editor in prod. -->
				{#each withUniqueKeys(referenceImages, (u) => u) as { item: url, key } (key)}
					<li class="relative">
						<!-- No "image"/"photo"/"picture" in the alt text: svelte's
						     a11y_img_redundant_alt rule flags those (a screen reader
						     already announces the element as an image). -->
						<img
							src={scopedMediaUrl(url)}
							alt={`Visual reference for ${name.trim() || 'this asset'}`}
							loading="lazy"
							class="h-16 w-16 rounded-[var(--radius-sm)] border border-[var(--color-border)] object-cover"
							data-testid="asset-reference-thumb"
						/>
						<button
							type="button"
							class="absolute -right-1.5 -top-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-strong)] p-0.5 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-danger)] disabled:opacity-40"
							aria-label={`Remove reference image ${referenceImages.indexOf(url) + 1}`}
							disabled={saving || uploading}
							onclick={() => removeReferenceImage(url)}
							data-testid="asset-reference-remove"
						>
							<X class="h-3 w-3" />
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<input
			id={`asset-reference-add-${uid}`}
			name={`asset-reference-add-${uid}`}
			type="file"
			accept=".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif"
			disabled={saving || uploading}
			class="text-sm text-[var(--color-text-muted)] file:mr-3 file:rounded-[var(--radius-md)] file:border file:border-[var(--color-border)] file:bg-[var(--color-surface-strong)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--color-text)]"
			onchange={addReferenceImage}
			data-testid="asset-reference-add"
		/>
		{#if uploading}
			<p class="text-xs text-[var(--color-text-muted)]" role="status">Uploading…</p>
		{/if}
	</div>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<!-- Seed: the one genuinely deterministic lever. Same descriptor + same
		     seed ⇒ the sampler retraces the same path, so the asset keeps its face
		     across shots. Empty ⇒ every render picks its own. -->
		<div class="flex flex-col gap-1.5">
			<label for={`asset-seed-${uid}`} class="text-sm font-medium text-[var(--color-text-muted)]">
				Seed
			</label>
			<!-- type="text" + inputmode="numeric", NOT type="number": Svelte coerces a
			     statically-typed number input's binding to `number | null`, which would
			     silently turn a typo into "no seed". Held as text and validated in
			     parseSeed() so a bad value is refused out loud. -->
			<input
				id={`asset-seed-${uid}`}
				name={`asset-seed-${uid}`}
				type="text"
				inputmode="numeric"
				disabled={saving}
				class={textareaClass}
				placeholder="Leave empty for a fresh seed each render"
				aria-describedby={`asset-seed-help-${uid}`}
				bind:value={seedText}
				data-testid="asset-seed"
			/>
			<p id={`asset-seed-help-${uid}`} class="text-xs text-[var(--color-text-muted)]">
				Pin a whole number to keep this asset looking the same across shots.
			</p>
		</div>

		<!-- Style token: a short tag appended to this asset's prompt. It steers
		     wording, not weights — no LoRA, no embedding is loaded for it today. -->
		<div class="flex flex-col gap-1.5">
			<label
				for={`asset-style-token-${uid}`}
				class="text-sm font-medium text-[var(--color-text-muted)]"
			>
				Style token
			</label>
			<input
				id={`asset-style-token-${uid}`}
				name={`asset-style-token-${uid}`}
				type="text"
				disabled={saving}
				class={textareaClass}
				placeholder="e.g. gritty-noir"
				aria-describedby={`asset-style-token-help-${uid}`}
				bind:value={styleToken}
				data-testid="asset-style-token"
			/>
			<p id={`asset-style-token-help-${uid}`} class="text-xs text-[var(--color-text-muted)]">
				A short tag carried into every prompt for this asset.
			</p>
		</div>
	</div>

	<div class="flex items-center justify-end gap-2">
		<button
			type="button"
			class="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
			disabled={saving}
			onclick={cancel}
			data-testid="asset-cancel"
		>
			Cancel
		</button>
		<button
			type="button"
			class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
			disabled={saveDisabled}
			onclick={save}
			data-testid="asset-save"
		>
			Save
		</button>
	</div>
</div>
