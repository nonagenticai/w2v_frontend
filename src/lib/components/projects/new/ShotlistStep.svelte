<script lang="ts">
	import { ShotlistEditor } from '$lib/components/studio';
	import { createWizard as cw } from './create-wizard.svelte.js';
</script>

<section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4">
	<div>
		<h2 class="text-base font-semibold text-[var(--color-text)]">Shotlist</h2>
		<p class="text-xs text-[var(--color-text-muted)] mt-1">
			Direct the video shot by shot. Add a <strong>URL shot</strong> to film part of a live page —
			say where to click, where to scroll, and how long to hold so viewers can read — or a
			<strong>slide</strong> to say something to camera, placed before, after, or between URL shots. Narration
			is read verbatim. Leave it empty to let the pipeline auto-direct from the brief.
		</p>
	</div>
	<ShotlistEditor bind:shotlist={cw.shotlist} />
</section>
