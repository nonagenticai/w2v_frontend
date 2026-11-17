<script lang="ts">
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	// Workspace music library (P6 FE-2) — /api/tenant/music.
	// Any member may list and audition (GET is member-readable); upload, edit and
	// delete are tenant_admin only (the server 403s on its own — the controls are
	// hidden from members so they never see a dead button). Rights are
	// TENANT-DECLARED: upload requires the attestation, and the label never claims
	// verified royalty-free. Every upload constraint (size cap, formats, categories,
	// description length) comes from the list response's `limits` — none is
	// hardcoded here. Playback: the track `url` is the same-origin
	// `/api/tenant/music/{id}/content` stream, fetched by `<audio src>` through the
	// cookie-auth fallback + `scopedMediaUrl`, like every other `/api/` media path.
	import { onMount } from 'svelte';
	import {
		tenantMusic,
		tenantMusicError,
		formatBytes,
		formatDuration,
		tenantMusicAccept,
		tenantMusicFormatLabel,
		type TenantMusicItem,
		type TenantMusicUploadLimits,
		type TenantSoundCategoryName
	} from '$lib/api/music.js';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import { isTenantAdmin } from '$lib/stores/auth.svelte';
	import { toastSuccess } from '$lib/stores/toast.svelte.js';
	import {
		Button,
		Card,
		Dialog,
		EmptyState,
		ErrorState,
		Input,
		Select,
		Skeleton,
		Spinner
	} from '$lib/components/ui';

	const canEdit = isTenantAdmin();

	let tracks = $state<TenantMusicItem[]>([]);
	let loading = $state(true);
	let loadError = $state<unknown>(null);
	let limits = $state<TenantMusicUploadLimits | null>(null);

	async function load(): Promise<void> {
		loadError = null;
		try {
			const res = await tenantMusic.list();
			tracks = res.tracks;
			limits = res.limits;
		} catch (e) {
			loadError = e;
		} finally {
			loading = false;
		}
	}
	onMount(() => void load());

	const categoryOptions = $derived(
		(limits?.categories ?? []).map((c) => ({
			value: c,
			label: c.charAt(0).toUpperCase() + c.slice(1)
		}))
	);
	const descriptionMax = $derived(limits?.max_description_length ?? null);
	const tooLong = (text: string): boolean =>
		descriptionMax !== null && text.trim().length > descriptionMax;
	const tooLongMessage = $derived(
		descriptionMax === null ? '' : `At most ${descriptionMax} characters.`
	);

	// --- Upload ---
	let file = $state<File | null>(null);
	let category = $state<TenantSoundCategoryName>('music');
	let description = $state('');
	let slug = $state('');
	let rightsAttested = $state(false);
	let uploading = $state(false);
	let uploadError = $state('');
	let fileInput = $state<HTMLInputElement | null>(null);

	// Refuse an over-cap file before sending it: the server would 422 it anyway,
	// but only after the whole body crossed the wire.
	const fileTooLarge = $derived(file !== null && limits !== null && file.size > limits.max_bytes);
	const canUpload = $derived(
		file !== null && rightsAttested && !uploading && !fileTooLarge && !tooLong(description)
	);

	async function upload(): Promise<void> {
		if (!file || !canUpload) return;
		uploading = true;
		uploadError = '';
		try {
			const track = await tenantMusic.upload({ file, rightsAttested, category, description, slug });
			tracks = [...tracks, track];
			toastSuccess('Track uploaded', `${track.sound_id} is available to new runs.`);
			file = null;
			description = '';
			slug = '';
			rightsAttested = false;
			if (fileInput) fileInput.value = '';
		} catch (e) {
			uploadError = tenantMusicError(e);
		} finally {
			uploading = false;
		}
	}

	// --- Edit ---
	let editingId = $state<string | null>(null);
	let editCategory = $state<TenantSoundCategoryName>('music');
	let editDescription = $state('');
	let rowError = $state<Record<string, string>>({});
	let busyId = $state<string | null>(null);

	function startEdit(t: TenantMusicItem): void {
		editingId = t.id;
		editCategory = t.category;
		editDescription = t.description;
	}

	async function saveEdit(t: TenantMusicItem): Promise<void> {
		if (tooLong(editDescription)) return;
		busyId = t.id;
		rowError = { ...rowError, [t.id]: '' };
		try {
			const next = await tenantMusic.update(t.id, {
				category: editCategory,
				description: editDescription
			});
			tracks = tracks.map((x) => (x.id === t.id ? next : x));
			editingId = null;
		} catch (e) {
			rowError = { ...rowError, [t.id]: tenantMusicError(e) };
		} finally {
			busyId = null;
		}
	}

	// --- Delete (confirmed) ---
	let pendingDelete = $state<TenantMusicItem | null>(null);
	let deleteOpen = $state(false);
	async function confirmDelete(): Promise<void> {
		const t = pendingDelete;
		deleteOpen = false;
		if (!t) return;
		busyId = t.id;
		try {
			await tenantMusic.remove(t.id);
			tracks = tracks.filter((x) => x.id !== t.id);
			toastSuccess('Track deleted', `${t.sound_id} is no longer offered to new runs.`);
		} catch (e) {
			rowError = { ...rowError, [t.id]: tenantMusicError(e) };
		} finally {
			busyId = null;
			pendingDelete = null;
		}
	}
</script>

<svelte:head>
	<title>Music library - Studio</title>
</svelte:head>

<Page width="narrow" testid="music-library">
	<PageHeader
		kicker="Workspace"
		title="Music library"
		subtitle="Your workspace's own music beds and sounds. New runs can pick them alongside the built-in library; a run that already picked a track keeps it."
	/>

	{#if canEdit && limits}
		<div data-testid="music-upload">
			<Card class="mb-8 p-5">
				<h2 class="mb-1 text-sm font-semibold text-[var(--color-text)]">Upload a track</h2>
				<p class="mb-4 text-xs text-[var(--color-text-muted)]" data-testid="music-upload-limits">
					{tenantMusicFormatLabel(limits)} audio, up to {formatBytes(
						limits.max_bytes
					)}{limits.max_duration_s ? ` and ${formatDuration(limits.max_duration_s)} long` : ''}. The
					format is read from the file itself; the file must decode and have a duration.
				</p>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-1.5 sm:col-span-2">
						<label for="music-file" class="text-sm font-medium text-[var(--color-text-muted)]"
							>Audio file</label
						>
						<input
							id="music-file"
							name="music-file"
							type="file"
							accept={tenantMusicAccept(limits)}
							bind:this={fileInput}
							onchange={(e) => (file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
							class="text-sm text-[var(--color-text)]"
						/>
						{#if fileTooLarge && file}
							<p class="text-xs text-status-failed" data-testid="music-file-too-large">
								{file.name} is {formatBytes(file.size)} — larger than the {formatBytes(
									limits.max_bytes
								)} limit.
							</p>
						{/if}
					</div>
					<Select
						name="music-category"
						label="Category"
						value={category}
						options={categoryOptions}
						placeholder=""
						onchange={(e) =>
							(category = (e.currentTarget as HTMLSelectElement).value as TenantSoundCategoryName)}
					/>
					<Input
						name="music-slug"
						label="Id (optional)"
						bind:value={slug}
						placeholder="a-z, 0-9, _ — defaults to the file name"
					/>
					<div class="sm:col-span-2">
						<Input
							name="music-description"
							label="Description (optional)"
							bind:value={description}
							placeholder="e.g. Upbeat synth bed, 120 bpm"
							error={tooLong(description) ? tooLongMessage : undefined}
						/>
					</div>
				</div>
				<label class="mt-4 flex items-start gap-2 text-sm text-[var(--color-text)]">
					<input
						type="checkbox"
						name="music-rights"
						bind:checked={rightsAttested}
						class="mt-0.5"
						data-testid="music-rights"
					/>
					<span>
						I confirm this workspace holds the rights to use this audio commercially.
						<span
							class="block text-xs text-[var(--color-text-muted)]"
							data-testid="music-rights-notice"
						>
							Uploaded tracks are labelled <strong>tenant-declared</strong>: the platform does not
							verify them, and they are never presented as royalty-free library music. You are
							responsible for the rights you declare.
						</span>
					</span>
				</label>
				{#if uploadError}
					<p class="mt-3 text-sm text-status-failed" data-testid="music-upload-error">
						{uploadError}
					</p>
				{/if}
				<div class="mt-4 flex justify-end">
					<Button variant="primary" size="sm" onclick={upload} disabled={!canUpload}>
						{#if uploading}<span class="mr-1.5 inline-block"><Spinner size="sm" /></span>{/if}
						Upload
					</Button>
				</div>
			</Card>
		</div>
	{/if}

	{#if loading}
		<Card class="p-5"><Skeleton height="4rem" /></Card>
	{:else if loadError}
		<ErrorState
			title="Couldn't load the music library"
			error={loadError}
			onRetry={() => void load()}
		/>
	{:else if tracks.length === 0}
		<EmptyState
			title="No tracks yet"
			description={canEdit
				? 'Upload a track to offer it to new runs.'
				: 'A workspace admin can upload tracks here.'}
		>
			{#snippet action()}
				{#if canEdit && limits}
					<Button variant="primary" onclick={() => document.getElementById('music-file')?.focus()}
						>Upload a track</Button
					>
				{/if}
			{/snippet}
		</EmptyState>
	{:else}
		<Card class="p-0">
			<ul class="divide-y divide-[var(--color-border)]" data-testid="music-tracks">
				{#each tracks as t (t.id)}
					<li class="px-5 py-4" data-testid="music-track" data-sound-id={t.sound_id}>
						<div class="flex flex-wrap items-baseline justify-between gap-2">
							<div>
								<span class="font-mono text-sm text-[var(--color-text)]">{t.sound_id}</span>
								<span class="ml-2 text-xs text-[var(--color-text-muted)]">{t.category}</span>
								<span class="ml-2 text-xs text-[var(--color-text-muted)]"
									>{formatDuration(t.duration_s)} · {formatBytes(t.bytes)}</span
								>
								<span
									class="ml-2 text-xs text-[var(--color-text-muted)]"
									title="Rights declared by your workspace, not verified by the platform"
									>Rights: tenant-declared</span
								>
							</div>
							{#if canEdit && editingId !== t.id}
								<div class="flex gap-2">
									<Button variant="ghost" size="sm" onclick={() => startEdit(t)}>Edit</Button>
									<Button
										variant="danger"
										size="sm"
										disabled={busyId === t.id}
										onclick={() => {
											pendingDelete = t;
											deleteOpen = true;
										}}>Delete</Button
									>
								</div>
							{/if}
						</div>
						{#if editingId === t.id}
							<div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="music-edit">
								<Select
									name={`music-edit-category-${t.id}`}
									label="Category"
									value={editCategory}
									options={categoryOptions}
									placeholder=""
									onchange={(e) =>
										(editCategory = (e.currentTarget as HTMLSelectElement)
											.value as TenantSoundCategoryName)}
								/>
								<div class="sm:col-span-2">
									<Input
										name={`music-edit-description-${t.id}`}
										label="Description"
										bind:value={editDescription}
										error={tooLong(editDescription) ? tooLongMessage : undefined}
									/>
								</div>
								<div class="flex gap-2 sm:col-span-3">
									<Button
										variant="primary"
										size="sm"
										disabled={busyId === t.id || tooLong(editDescription)}
										onclick={() => saveEdit(t)}>Save</Button
									>
									<Button variant="ghost" size="sm" onclick={() => (editingId = null)}
										>Cancel</Button
									>
								</div>
							</div>
						{:else if t.description}
							<p class="mt-1 text-sm text-[var(--color-text-secondary)]">{t.description}</p>
						{/if}
						{#if t.url}
							<audio class="mt-2 w-full" controls preload="none" src={scopedMediaUrl(t.url)}>
								<track kind="captions" />
							</audio>
						{:else}
							<p class="mt-2 text-xs text-[var(--color-text-muted)]">Preview unavailable.</p>
						{/if}
						{#if rowError[t.id]}
							<p class="mt-2 text-sm text-status-failed" data-testid="music-row-error">
								{rowError[t.id]}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
		</Card>
	{/if}
</Page>

<Dialog bind:open={deleteOpen} title="Delete this track?">
	{#if deleteOpen && pendingDelete}
		<div class="flex flex-col gap-4" data-testid="music-delete-confirm">
			<p class="text-sm text-[var(--color-text)]">
				<span class="font-mono">{pendingDelete.sound_id}</span> stops being offered to new runs at once.
				A run that already picked it keeps rendering it until the run finishes.
			</p>
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (deleteOpen = false)}>Cancel</Button>
				<Button variant="danger" size="sm" onclick={confirmDelete}>Delete</Button>
			</div>
		</div>
	{/if}
</Dialog>
