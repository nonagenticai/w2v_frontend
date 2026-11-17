<script lang="ts">
	import { Button } from '$lib/components/ui';
	import { course } from '$lib/api';
	import { ApiError } from '$lib/api';
	import { Camera, Upload, RotateCcw } from '@lucide/svelte';

	let {
		runId,
		hasOverride,
		captureFrame,
		onSaved
	}: {
		runId: string;
		hasOverride: boolean;
		// Delegates to VideoPlayer.captureFrame(); null when the frame can't be
		// drawn (no metadata yet) or the canvas is tainted.
		captureFrame: () => Promise<Blob | null>;
		onSaved: (output: Record<string, unknown>) => void;
	} = $props();

	let busy = $state(false);
	let error = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement>();

	async function applyBlob(blob: Blob, filename: string) {
		busy = true;
		error = null;
		try {
			const { thumbnail_url } = await course.uploadThumbnail(blob, filename);
			const updated = await course.patchThumbnail(runId, thumbnail_url);
			onSaved(updated.output ?? {});
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'Could not update the thumbnail.';
		} finally {
			busy = false;
		}
	}

	async function useCurrentFrame() {
		error = null;
		const blob = await captureFrame();
		if (!blob) {
			error = 'Could not capture this frame — try uploading an image instead.';
			return;
		}
		await applyBlob(blob, 'frame.png');
	}

	async function onFile(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) await applyBlob(file, file.name);
		if (fileInput) fileInput.value = '';
	}

	async function revert() {
		busy = true;
		error = null;
		try {
			const updated = await course.patchThumbnail(runId, null);
			onSaved(updated.output ?? {});
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'Could not revert the thumbnail.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="space-y-2">
	<div class="flex flex-wrap gap-2">
		<Button size="sm" variant="secondary" onclick={useCurrentFrame} disabled={busy}>
			<Camera class="h-4 w-4" /> Use current frame
		</Button>
		<Button size="sm" variant="secondary" onclick={() => fileInput?.click()} disabled={busy}>
			<Upload class="h-4 w-4" /> Upload image
		</Button>
		{#if hasOverride}
			<Button size="sm" variant="ghost" onclick={revert} disabled={busy}>
				<RotateCcw class="h-4 w-4" /> Revert to auto cover
			</Button>
		{/if}
	</div>
	<input
		bind:this={fileInput}
		type="file"
		accept="image/png,image/jpeg,image/webp"
		class="hidden"
		onchange={onFile}
	/>
	{#if error}
		<p class="text-xs text-red-400" role="alert">{error}</p>
	{/if}
</div>
