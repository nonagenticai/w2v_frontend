<script lang="ts">
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	// Tenant API keys (P2 WP4b) — GET/POST /api/tenant/api-keys, DELETE …/{id}.
	// A key acts in THIS workspace with the `member` role, never as the admin who
	// created it. The secret (`w2v_sk_…`) is returned exactly once, by create; the
	// server stores only its hash, so the reveal panel below is the user's only
	// chance to copy it. It lives in component state only — never persisted.
	// P8: a key may carry extra scopes (`connections:write`), chosen at create time and
	// shown on every row; with none it is a plain member key.
	import {
		API_KEY_SCOPES,
		apiKeyScopeLabel,
		tenancy,
		tenancyErrorMessage,
		type ApiKeyScope,
		type ApiKeySummary
	} from '$lib/api/tenancy.js';
	import {
		Badge,
		Button,
		Card,
		Dialog,
		EmptyState,
		ErrorState,
		Input,
		Skeleton
	} from '$lib/components/ui';
	import { formatDateTime } from '$lib/utils/format';
	import { toastSuccess } from '$lib/stores/toast.svelte.js';

	let keys = $state<ApiKeySummary[]>([]);
	let loading = $state(true);
	let error = $state<unknown>(null);
	let actionError = $state<string | null>(null);
	let busyId = $state<string | null>(null);

	async function load(): Promise<void> {
		loading = true;
		error = null;
		try {
			keys = (await tenancy.apiKeys()).items;
		} catch (e) {
			error = e;
		} finally {
			loading = false;
		}
	}
	$effect(() => {
		void load();
	});

	// ─── Create ──────────────────────────────────────────────────────────
	let createOpen = $state(false);
	let name = $state('');
	let expiresOn = $state(''); // yyyy-mm-dd, optional
	let scopes = $state<ApiKeyScope[]>([]);

	function toggleScope(scope: ApiKeyScope, on: boolean): void {
		scopes = on ? [...new Set([...scopes, scope])] : scopes.filter((s) => s !== scope);
	}
	let creating = $state(false);
	let createError = $state<string | null>(null);
	let revealed = $state<{ name: string; key: string } | null>(null);
	let copied = $state(false);

	function openCreate(): void {
		name = '';
		expiresOn = '';
		scopes = [];
		createError = null;
		createOpen = true;
	}

	async function create(): Promise<void> {
		if (!name.trim() || creating) return;
		creating = true;
		createError = null;
		try {
			const expiresAt = expiresOn ? new Date(`${expiresOn}T23:59:59Z`).toISOString() : null;
			const res = await tenancy.createApiKey(name.trim(), expiresAt, scopes);
			createOpen = false;
			revealed = { name: res.name, key: res.key };
			copied = false;
			await load();
		} catch (e) {
			createError = tenancyErrorMessage(e, 'Could not create the key. Try again.');
		} finally {
			creating = false;
		}
	}

	async function copyKey(): Promise<void> {
		if (!revealed) return;
		try {
			await navigator.clipboard.writeText(revealed.key);
			copied = true;
		} catch {
			/* clipboard unavailable — the key is on screen to select by hand */
		}
	}

	// ─── Revoke ──────────────────────────────────────────────────────────
	let revokeOpen = $state(false);
	let pendingRevoke = $state<ApiKeySummary | null>(null);

	function requestRevoke(k: ApiKeySummary): void {
		actionError = null;
		pendingRevoke = k;
		revokeOpen = true;
	}

	async function confirmRevoke(): Promise<void> {
		const k = pendingRevoke;
		revokeOpen = false;
		pendingRevoke = null;
		if (!k) return;
		busyId = k.id;
		try {
			await tenancy.revokeApiKey(k.id);
			toastSuccess('Key revoked', `“${k.name}” stops working immediately.`);
			await load();
		} catch (e) {
			actionError = tenancyErrorMessage(e, 'Could not revoke the key.');
		} finally {
			busyId = null;
		}
	}
</script>

<Page width="narrow" testid="api-keys-home">
	<PageHeader
		kicker="Workspace"
		title="API keys"
		subtitle="Keys let scripts and integrations call Studio as this workspace, with member permissions plus any scopes you grant."
	>
		{#snippet actions()}
			<Button variant="primary" onclick={openCreate}>Create key</Button>
		{/snippet}
	</PageHeader>

	{#if revealed}
		<div class="mb-4" data-testid="api-key-secret">
			<Card class="p-4">
				<p class="text-sm font-medium text-[var(--color-text)]">
					Copy your new key “{revealed.name}” now
				</p>
				<p class="mt-1 text-sm text-[var(--color-danger)]" data-testid="api-key-secret-warning">
					This is the only time the key is shown. If you lose it, revoke it and create a new one.
				</p>
				<div class="mt-2 flex items-center gap-2">
					<code
						class="min-w-0 flex-1 truncate rounded border border-[var(--color-border)] p-2 text-xs"
						data-testid="api-key-secret-value">{revealed.key}</code
					>
					<Button variant="secondary" size="sm" onclick={copyKey}
						>{copied ? 'Copied' : 'Copy'}</Button
					>
				</div>
				<div class="mt-3 flex justify-end">
					<Button variant="ghost" size="sm" onclick={() => (revealed = null)}>I've saved it</Button>
				</div>
			</Card>
		</div>
	{/if}

	{#if actionError}
		<p class="mb-3 text-sm text-[var(--color-danger)]" data-testid="api-keys-action-error">
			{actionError}
		</p>
	{/if}

	{#if loading}
		<Card class="p-2"><Skeleton variant="text" count={4} height="2.25rem" /></Card>
	{:else if error}
		<ErrorState title="Couldn't load API keys" {error} onRetry={load} />
	{:else if keys.length === 0}
		<EmptyState title="No API keys" description="Create one to call Studio from a script.">
			{#snippet action()}
				<Button variant="primary" onclick={openCreate}>Create key</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<Card>
			<ul class="divide-y divide-[var(--color-border)]" data-testid="api-keys-list">
				{#each keys as k (k.id)}
					<li
						class="flex flex-wrap items-center justify-between gap-3 p-4"
						data-testid="api-keys-row"
					>
						<div class="min-w-0">
							<p class="truncate text-sm font-medium text-[var(--color-text)]">{k.name}</p>
							<p class="font-mono text-xs text-[var(--color-text-muted)]">{k.prefix}…</p>
							<div class="mt-1 flex flex-wrap gap-1" data-testid="api-key-scopes">
								{#each k.scopes ?? [] as scope (scope)}
									<Badge variant="info">{apiKeyScopeLabel(scope)}</Badge>
								{:else}
									<span class="text-xs text-[var(--color-text-muted)]">Member access only</span>
								{/each}
							</div>
							<p class="mt-0.5 text-xs text-[var(--color-text-muted)]">
								Created {formatDateTime(k.created_at) || '—'} · last used {formatDateTime(
									k.last_used_at ?? null
								) || 'never'}{#if k.expires_at}
									· expires {formatDateTime(k.expires_at)}{/if}
							</p>
						</div>
						<Button
							variant="ghost"
							size="sm"
							loading={busyId === k.id}
							onclick={() => requestRevoke(k)}>Revoke</Button
						>
					</li>
				{/each}
			</ul>
		</Card>
	{/if}
</Page>

<Dialog bind:open={createOpen} title="Create API key">
	{#if createOpen}
		<form
			class="flex flex-col gap-4"
			data-testid="api-key-create-form"
			onsubmit={(e) => {
				e.preventDefault();
				void create();
			}}
		>
			<Input name="api-key-name" label="Name" placeholder="CI pipeline" bind:value={name} />
			<Input name="api-key-expires" label="Expires (optional)" type="date" bind:value={expiresOn} />
			<fieldset class="flex flex-col gap-2" data-testid="api-key-scopes-picker">
				<legend class="text-sm font-medium text-[var(--color-text)]">Scopes (optional)</legend>
				{#each API_KEY_SCOPES as scope (scope.value)}
					<label class="flex items-start gap-2 text-sm text-[var(--color-text)]">
						<input
							type="checkbox"
							class="mt-0.5"
							value={scope.value}
							checked={scopes.includes(scope.value)}
							onchange={(e) => toggleScope(scope.value, e.currentTarget.checked)}
						/>
						<span>
							<span class="font-medium">{scope.label}</span>
							<code class="ml-1 text-xs">{scope.value}</code>
							<span class="block text-xs text-[var(--color-text-muted)]">{scope.description}</span>
						</span>
					</label>
				{/each}
			</fieldset>
			{#if createError}
				<p class="text-sm text-[var(--color-danger)]" data-testid="api-key-create-error">
					{createError}
				</p>
			{/if}
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (createOpen = false)}>Cancel</Button>
				<Button type="submit" variant="primary" size="sm" loading={creating} disabled={!name.trim()}
					>Create</Button
				>
			</div>
		</form>
	{/if}
</Dialog>

<Dialog bind:open={revokeOpen} title="Revoke API key?">
	{#if pendingRevoke}
		<div class="flex flex-col gap-4" data-testid="api-key-revoke-confirm">
			<p class="text-sm text-[var(--color-text)]">
				Anything using <strong>{pendingRevoke.name}</strong> stops working immediately. This can't be
				undone.
			</p>
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (revokeOpen = false)}>Cancel</Button>
				<Button variant="danger" size="sm" onclick={confirmRevoke}>Revoke</Button>
			</div>
		</div>
	{/if}
</Dialog>
