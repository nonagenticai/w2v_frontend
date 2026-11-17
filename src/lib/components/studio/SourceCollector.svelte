<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { uploads } from '$lib/api';
	import { ApiError } from '$lib/api';
	import { toastError } from '$lib/stores/toast.svelte.js';
	import type { ProjectSource } from '$lib/types';
	import { isValidUrl } from '$lib/utils/validation';
	import {
		Link2,
		FileText,
		Image,
		Plus,
		Trash2,
		Upload,
		Loader2,
		ChevronDown
	} from '@lucide/svelte';

	let { sources = $bindable<ProjectSource[]>([]) }: { sources?: ProjectSource[] } = $props();

	const DOC_ACCEPT = '.pdf,.txt,.docx,.epub,.md,.markdown';

	let uploading = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);
	// Which url rows have their auth panel expanded (by index).
	const authOpen = new SvelteSet<number>();

	function addUrl() {
		sources = [...sources, { kind: 'url', ref: '', label: '' }];
	}

	function remove(index: number) {
		sources = sources.filter((_, i) => i !== index);
		authOpen.delete(index);
	}

	function setRef(index: number, value: string) {
		sources = sources.map((s, i) => (i === index ? { ...s, ref: value } : s));
	}

	function toggleAuth(index: number) {
		if (authOpen.has(index)) authOpen.delete(index);
		else authOpen.add(index);
	}

	type AuthInfo = NonNullable<ProjectSource['auth_info']>;
	function setAuth(index: number, patch: Partial<AuthInfo>) {
		sources = sources.map((s, i) => {
			if (i !== index) return s;
			const auth = { ...(s.auth_info ?? { type: 'none' }), ...patch };
			return { ...s, auth_info: auth };
		});
	}

	async function onFiles(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = ''; // allow re-selecting the same file
		if (!files.length) return;
		uploading = true;
		try {
			for (const file of files) {
				const res = await uploads.document(file);
				sources = [
					...sources,
					{ kind: 'document', ref: res.document_ref, label: res.document_name }
				];
			}
		} catch (err) {
			const detail = err instanceof ApiError ? err.detail : 'Upload failed';
			toastError('Could not upload document', detail);
		} finally {
			uploading = false;
		}
	}

	const kindIcon = { url: Link2, document: FileText, media: Image } as const;
</script>

<div class="space-y-3">
	{#if sources.length === 0}
		<p class="text-xs text-[var(--color-text-muted)]">
			No sources yet. Add a website, upload a document, or pin media below — the pipeline reads them
			to ground the script and visuals.
		</p>
	{/if}

	{#each sources as source, i (i)}
		{@const Icon = kindIcon[source.kind]}
		<div
			class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
		>
			<div class="flex items-center gap-3">
				<Icon class="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
				{#if source.kind === 'url'}
					<input
						type="url"
						placeholder="https://example.com"
						value={source.ref}
						oninput={(e) => setRef(i, (e.currentTarget as HTMLInputElement).value)}
						class="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
					/>
					<button
						type="button"
						onclick={() => toggleAuth(i)}
						class="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] inline-flex items-center gap-1"
					>
						Auth <ChevronDown class="h-3 w-3 {authOpen.has(i) ? 'rotate-180' : ''}" />
					</button>
				{:else}
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm text-[var(--color-text)]">{source.label || source.ref}</p>
						<p class="text-xs text-[var(--color-text-muted)] capitalize">{source.kind}</p>
					</div>
				{/if}
				<button
					type="button"
					onclick={() => remove(i)}
					aria-label="Remove source"
					class="rounded p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-danger)]"
				>
					<Trash2 class="h-4 w-4" />
				</button>
			</div>

			{#if source.kind === 'url' && !isValidUrl((source.ref || '').trim()) && (source.ref || '').trim().length > 0}
				<p class="mt-1 pl-7 text-xs text-[var(--color-danger)]">
					Enter a valid URL (with https://).
				</p>
			{/if}

			{#if source.kind === 'url' && authOpen.has(i)}
				<div class="mt-3 space-y-2 pl-7">
					<select
						value={source.auth_info?.type ?? 'none'}
						onchange={(e) =>
							setAuth(i, {
								type: (e.currentTarget as HTMLSelectElement).value as AuthInfo['type']
							})}
						class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
					>
						<option value="none">No auth</option>
						<option value="basic">Basic</option>
						<option value="bearer">Bearer token</option>
					</select>
					{#if source.auth_info?.type === 'basic'}
						<div class="grid grid-cols-2 gap-2">
							<input
								placeholder="Username"
								value={source.auth_info?.username ?? ''}
								oninput={(e) =>
									setAuth(i, { username: (e.currentTarget as HTMLInputElement).value })}
								class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
							/>
							<input
								type="password"
								placeholder="Password"
								value={source.auth_info?.password ?? ''}
								oninput={(e) =>
									setAuth(i, { password: (e.currentTarget as HTMLInputElement).value })}
								class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
							/>
						</div>
					{:else if source.auth_info?.type === 'bearer'}
						<input
							placeholder="Bearer token"
							value={source.auth_info?.token ?? ''}
							oninput={(e) => setAuth(i, { token: (e.currentTarget as HTMLInputElement).value })}
							class="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
						/>
					{/if}
				</div>
			{/if}
		</div>
	{/each}

	<div class="flex flex-wrap gap-2">
		<button
			type="button"
			onclick={addUrl}
			class="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-text)]"
		>
			<Plus class="h-3.5 w-3.5" /> Add URL
		</button>
		<button
			type="button"
			onclick={() => fileInput?.click()}
			disabled={uploading}
			class="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-text)] disabled:opacity-50"
		>
			{#if uploading}
				<Loader2 class="h-3.5 w-3.5 animate-spin" /> Uploading…
			{:else}
				<Upload class="h-3.5 w-3.5" /> Upload document
			{/if}
		</button>
		<input
			bind:this={fileInput}
			type="file"
			accept={DOC_ACCEPT}
			multiple
			class="hidden"
			data-testid="source-document-input"
			onchange={onFiles}
		/>
	</div>
</div>
