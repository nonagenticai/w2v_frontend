<script lang="ts">
	import { Wifi, WifiOff, Loader, Trash2, Copy, Check } from '@lucide/svelte';
	import { toastError } from '$lib/stores/toast.svelte.js';
	import type { ConnectionStatus } from '$lib/stores/job-progress';

	let {
		logs,
		isStreaming = false,
		connectionStatus = 'disconnected',
		maxHeight = '400px',
		onclear,
		class: className = ''
	}: {
		logs: string[];
		isStreaming?: boolean;
		connectionStatus?: ConnectionStatus;
		maxHeight?: string;
		onclear?: () => void;
		class?: string;
	} = $props();

	let containerEl: HTMLDivElement | undefined = $state();
	let userScrolledUp = $state(false);
	let copied = $state(false);

	function handleScroll() {
		if (!containerEl) return;
		const { scrollTop, scrollHeight, clientHeight } = containerEl;
		userScrolledUp = scrollHeight - scrollTop - clientHeight > 20;
	}

	$effect(() => {
		const _len = logs.length;
		if (!userScrolledUp && containerEl) {
			requestAnimationFrame(() => {
				containerEl?.scrollTo({ top: containerEl.scrollHeight });
			});
		}
	});

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(logs.join('\n'));
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch {
			// The clipboard write is refused on an insecure origin, without focus,
			// or under a restrictive permissions policy. Swallowing it made "Copy
			// logs" a button that visibly does nothing. Failure only — the `copied`
			// check icon is already the success signal, so a success toast here
			// would double-signal (contrast with GrowthSnippetCards.svelte:34-41,
			// which has no inline signal and therefore toasts both ways).
			toastError('Could not copy logs', 'Your browser blocked clipboard access.');
		}
	}

	function handleClear() {
		if (onclear) onclear();
	}

	const connectionIcon = $derived.by(() => {
		switch (connectionStatus) {
			case 'connected':
				return { label: 'Connected', colorClass: 'text-[var(--color-success)]' };
			case 'connecting':
				return {
					label: 'Reconnecting...',
					colorClass: 'text-[var(--color-warning)] animate-pulse'
				};
			case 'failed':
				return { label: 'Disconnected', colorClass: 'text-[var(--color-danger)]' };
			default:
				return { label: 'Disconnected', colorClass: 'text-[var(--color-text-muted)]' };
		}
	});
</script>

<div class="rounded-lg border border-[var(--color-border)] overflow-hidden {className}">
	<!-- Header bar -->
	<div
		class="flex items-center justify-between bg-[var(--color-surface)] px-3 py-2 border-b border-[var(--color-border)]"
	>
		<div class="flex items-center gap-2">
			<span class="text-xs font-medium text-[var(--color-text-muted)]">Logs</span>
			<!-- Connection status -->
			<span class="flex items-center gap-1 text-xs {connectionIcon.colorClass}">
				{#if connectionStatus === 'connected'}
					<Wifi class="h-3 w-3" />
				{:else if connectionStatus === 'connecting'}
					<Loader class="h-3 w-3 animate-spin" />
				{:else}
					<WifiOff class="h-3 w-3" />
				{/if}
				<span class="hidden sm:inline">{connectionIcon.label}</span>
			</span>
			{#if isStreaming}
				<span class="flex items-center gap-1 text-xs text-[var(--color-success)]">
					<span class="h-1.5 w-1.5 rounded-full bg-[var(--color-success)] animate-pulse"></span>
					Live
				</span>
			{/if}
		</div>

		<div class="flex items-center gap-1">
			<!-- Copy button -->
			<button
				type="button"
				onclick={handleCopy}
				data-testid="copy-logs-btn"
				class="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-strong)] transition-colors"
				title={copied ? 'Logs copied' : 'Copy logs'}
				aria-label={copied ? 'Logs copied' : 'Copy logs'}
				disabled={logs.length === 0}
			>
				{#if copied}
					<Check class="h-3.5 w-3.5 text-[var(--color-success)]" aria-hidden="true" />
				{:else}
					<Copy class="h-3.5 w-3.5" aria-hidden="true" />
				{/if}
			</button>

			<!-- Clear button -->
			{#if onclear}
				<button
					type="button"
					onclick={handleClear}
					class="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-strong)] transition-colors"
					data-testid="clear-logs-btn"
					title="Clear logs"
					aria-label="Clear logs"
					disabled={logs.length === 0}
				>
					<Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
				</button>
			{/if}
		</div>
	</div>

	<!-- Log content -->
	<div
		bind:this={containerEl}
		onscroll={handleScroll}
		class="bg-[var(--color-bg)] p-3 font-mono text-xs overflow-y-auto leading-5"
		style:max-height={maxHeight}
	>
		{#if logs.length === 0}
			<p class="italic text-[var(--color-text-muted)]">Waiting for logs...</p>
		{:else}
			{#each logs as line, i (i)}
				<div class="text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]/50">
					<span class="text-[var(--color-text-muted)] select-none mr-2"
						>{String(i + 1).padStart(3, ' ')}</span
					>{line}
				</div>
			{/each}
		{/if}
	</div>
</div>
