<script lang="ts">
	import { ProjectTypePicker } from '$lib/components/studio';
	import { createWizard as cw } from './create-wizard.svelte.js';
</script>

<section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4">
	<div>
		<h2 class="text-base font-semibold text-[var(--color-text)]">What are you making?</h2>
		<p class="text-xs text-[var(--color-text-muted)] mt-1">
			The type fixes the blueprint (which stages run), the default deliverable shape, and
			child-project semantics.
		</p>
	</div>
	<!-- Function binding: a type change must go through setProjectType so an
	     already-created draft of the old type (and its type-specific state) is
	     dropped instead of being finalized as the wrong type. -->
	<ProjectTypePicker bind:value={() => cw.projectType, (t) => cw.setProjectType(t)} />
</section>
