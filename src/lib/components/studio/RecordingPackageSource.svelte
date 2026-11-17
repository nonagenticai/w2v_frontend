<script lang="ts">
	import { Upload, FileCheck, Loader, AlertCircle } from '@lucide/svelte';
	import { uploads } from '$lib/api';
	import { parsePackageClipRoster } from '$lib/studio/clip-roster';
	import type { ProjectBrief } from '$lib/types';

	// Authored-showcase source: upload a hand-crafted Playwright recording package
	// (.zip) — the record stage re-runs it live. Mirrors AudiobookSource: writes the
	// package_url onto the bound brief and drops it on error so the step stays
	// invalid until a good upload. The clip↔beat spine (brief.lines) is authored in
	// the separate Beats step (ClipBeatEditor), which also imports a lines.json.
	//
	// `clipRoster` is the set of `@clip-<n>` footage tags parsed out of the uploaded
	// package (normalized to their `clip-<n>` join key). It's threaded forward to the
	// Beats step so ClipBeatEditor can offer a <select> of real clips instead of a
	// free-text guess. UI-only; never submitted.
	let {
		brief = $bindable<ProjectBrief>({}),
		// Write-only here (the parent reads it via the binding), so eslint can't see
		// the default is used — it guards against an unbound parent.
		// eslint-disable-next-line no-useless-assignment
		clipRoster = $bindable<string[]>([])
	}: { brief?: ProjectBrief; clipRoster?: string[] } = $props();

	let uploading = $state(false);
	let uploadError = $state('');
	let packageName = $state('');
	// Set when the package uploaded fine but its zip could not be read. Distinct from
	// uploadError: the upload SUCCEEDED (package_url stands) — we just can't offer the
	// clip picker, and saying nothing would imply the package declares no clips.
	let rosterWarning = $state(false);

	const PACKAGE_ACCEPT = '.zip';

	async function onPackageChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		uploading = true;
		uploadError = '';
		rosterWarning = false;
		try {
			const res = await uploads.recordingPackage(file);
			brief = { ...brief, package_url: res.package_url };
			packageName = file.name;
			// Read the package's @clip-<n> footage tags for the Beats editor.
			// parsePackageClipRoster never throws (a throw here would land in the upload
			// catch below and falsely report "Upload failed" on a good upload); when the
			// zip itself is unreadable it says so, and we warn instead of pretending the
			// package simply declares no clips.
			const roster = await parsePackageClipRoster(file);
			clipRoster = roster.tags;
			rosterWarning = roster.unreadable;
		} catch (err) {
			uploadError = err instanceof Error ? err.message : 'Upload failed';
			// Drop any stale ref so the step stays invalid until a good upload.
			const { package_url: _p, ...rest } = brief;
			brief = rest;
			packageName = '';
			clipRoster = [];
			rosterWarning = false;
		} finally {
			uploading = false;
		}
	}
</script>

<div class="space-y-5">
	<div>
		<p class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5">Recording package</p>
		<label
			class="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 hover:border-[var(--color-accent)]"
		>
			{#if uploading}
				<Loader class="h-5 w-5 animate-spin text-[var(--color-accent)]" />
				<span class="text-sm text-[var(--color-text-muted)]">Uploading…</span>
			{:else if brief.package_url}
				<FileCheck class="h-5 w-5 text-[var(--color-success)]" />
				<span class="text-sm text-[var(--color-text)]" data-testid="package-name"
					>{packageName || 'Recording package uploaded'}</span
				>
				<span class="ml-auto text-xs text-[var(--color-text-muted)]">Replace</span>
			{:else}
				<Upload class="h-5 w-5 text-[var(--color-text-muted)]" />
				<span class="text-sm text-[var(--color-text-muted)]">Upload a .zip recording package</span>
			{/if}
			<input
				type="file"
				accept={PACKAGE_ACCEPT}
				class="sr-only"
				data-testid="package-input"
				onchange={onPackageChange}
			/>
		</label>
		{#if uploadError}
			<p class="mt-1 flex items-center gap-1 text-xs text-[var(--color-danger)]">
				<AlertCircle class="h-3.5 w-3.5" />
				{uploadError}
			</p>
		{:else}
			<p class="mt-1 text-xs text-[var(--color-text-muted)]">
				A Playwright-BDD bundle (features + steps + assets). The recorder re-runs it live to capture
				the real walkthrough. Build one from the shared scaffold in bdd_playwright_service.
			</p>
		{/if}
		{#if rosterWarning}
			<p
				class="mt-1 flex items-center gap-1 text-xs text-[var(--color-warning)]"
				data-testid="package-roster-warning"
			>
				<AlertCircle class="h-3.5 w-3.5 shrink-0" />
				Uploaded, but we couldn't read the clip tags from this package — it may use an unsupported zip
				format. The Beats step won't list its clips, so type each clip key (e.g. clip-1) by hand and make
				sure it matches a @clip- tag in your features.
			</p>
		{/if}
	</div>
</div>
