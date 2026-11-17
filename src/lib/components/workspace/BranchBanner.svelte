<script lang="ts">
	// A storyboard branch is a real project with a hidden front door: it is excluded
	// from the projects list, so once you land on /projects/{child_project_id} there
	// is nothing on screen saying you left the original board and no way back to it.
	// This banner IS that door — it is the only thing in the workspace that names the
	// root project and links to it.
	//
	// It renders only when the detail response carries `branch` (i.e. this project IS
	// a fork). Ordinary projects get nothing at all — no empty strip, no placeholder.
	//
	// A merged/abandoned branch is read-only history, not a live lane: editing it
	// changes nothing that ships, so the banner says so explicitly rather than letting
	// the user assume their work is still in play.
	import { resolve } from '$app/paths';
	import { Pill } from '$lib/components/ui';
	import { ArrowLeft, GitBranch } from '@lucide/svelte';
	import type { BranchContext } from '$lib/types';

	let { branch }: { branch: BranchContext } = $props();

	type PillTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

	const tone = $derived<PillTone>(
		branch.status === 'open' ? 'accent' : branch.status === 'merged' ? 'success' : 'neutral'
	);

	// Branch-of-branch: `ancestors` is the lineage immediate-parent-first → root-last
	// (a single element for a direct branch; absent on an orchestrator that predates the
	// field — fall back to the one-hop render). We show a full lineage breadcrumb only
	// when the chain is deeper than one hop; a direct branch's `root_title` already says
	// everything. Rendered ROOT-FIRST with "→" reading "has branch", each hop a link so
	// the user can jump to any level, not just one hop up.
	const lineage = $derived(branch.ancestors ?? []);
	const rootFirstChain = $derived(lineage.length > 1 ? [...lineage].reverse() : []);

	// What the status means for the person standing in this workspace, not what the
	// column says.
	const note = $derived(
		branch.status === 'merged'
			? 'This branch was merged back — it is read-only history, not a live lane.'
			: branch.status === 'abandoned'
				? 'This branch was abandoned — it is read-only history, not a live lane.'
				: null
	);
</script>

<div
	class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-2"
	data-testid="branch-banner"
>
	<GitBranch class="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />

	<div class="min-w-0 flex-1 space-y-0.5">
		<p class="text-sm text-[var(--color-text)]">
			Branch of <span class="font-medium">{branch.root_title}</span>
			<span class="text-[var(--color-text-muted)]"> · {branch.name}</span>
		</p>
		{#if rootFirstChain.length > 0}
			<p
				class="flex flex-wrap items-center gap-x-1 text-xs text-[var(--color-text-muted)]"
				data-testid="branch-banner-lineage"
			>
				<span>Lineage:</span>
				{#each rootFirstChain as ancestor, i (ancestor.project_id)}
					<a
						href={resolve(`/projects/${ancestor.project_id}`)}
						class="underline decoration-dotted underline-offset-2 hover:text-[var(--color-text)]"
						data-testid="branch-banner-lineage-hop"
					>
						{ancestor.title}
					</a>
					{#if i < rootFirstChain.length - 1}
						<span aria-hidden="true">→</span>
					{/if}
				{/each}
				<span aria-hidden="true">→</span>
				<span class="text-[var(--color-text)]">{branch.name}</span>
			</p>
		{/if}
		{#if note}
			<p class="text-xs text-[var(--color-text-muted)]" data-testid="branch-banner-note">{note}</p>
		{/if}
	</div>

	<Pill {tone}>{branch.status}</Pill>

	<a
		href={resolve(`/projects/${branch.root_project_id}`)}
		class="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)]"
		data-testid="branch-banner-root-link"
	>
		<ArrowLeft class="h-3.5 w-3.5" />
		Back to {branch.root_title}
	</a>
</div>
