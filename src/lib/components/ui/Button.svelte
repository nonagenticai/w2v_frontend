<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- Button accepts arbitrary href; consumers handle resolve. */
	import Spinner from './Spinner.svelte';
	import type { Snippet } from 'svelte';

	let {
		variant = 'primary',
		size = 'md',
		loading = false,
		disabled = false,
		href,
		download,
		type = 'button',
		children,
		onclick,
		'aria-label': ariaLabel,
		class: className = ''
	}: {
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
		size?: 'sm' | 'md' | 'lg';
		loading?: boolean;
		disabled?: boolean;
		href?: string;
		download?: boolean | string;
		type?: 'button' | 'submit' | 'reset';
		children: Snippet;
		onclick?: (e: MouseEvent) => void;
		'aria-label'?: string;
		class?: string;
	} = $props();

	const baseClasses =
		'inline-flex items-center justify-center gap-2 font-medium rounded-[var(--radius-md)] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-bg)] disabled:opacity-40 disabled:cursor-not-allowed';

	const variantClasses = {
		primary:
			'bg-[var(--color-accent)] text-[var(--color-on-primary)] hover:bg-[var(--color-accent-strong)] active:bg-[var(--color-accent-strong)] hover:shadow-soft',
		secondary:
			'bg-[var(--color-surface-strong)] border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-border)]',
		ghost:
			'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]',
		danger:
			'bg-[var(--color-danger)] text-[var(--color-on-primary)] hover:opacity-90 active:opacity-80'
	};

	const sizeClasses = {
		sm: 'px-3 py-1.5 text-sm',
		md: 'px-4 py-2 text-sm',
		lg: 'px-6 py-3 text-base'
	};
</script>

{#if href && !disabled}
	<a
		{href}
		download={download ? (typeof download === 'string' ? download : '') : undefined}
		data-sveltekit-reload={download ? '' : undefined}
		aria-label={ariaLabel}
		class="{baseClasses} {variantClasses[variant]} {sizeClasses[size]} {className}"
	>
		{#if loading}<Spinner size="sm" />{/if}
		{@render children()}
	</a>
{:else}
	<button
		{type}
		{onclick}
		disabled={disabled || loading}
		aria-label={ariaLabel}
		class="{baseClasses} {variantClasses[variant]} {sizeClasses[size]} {className}"
	>
		{#if loading}<Spinner size="sm" />{/if}
		{@render children()}
	</button>
{/if}
