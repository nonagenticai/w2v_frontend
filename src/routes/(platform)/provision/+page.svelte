<script lang="ts">
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	// Platform provision screen (super_admin only). Provisions a new tenant + its
	// first user via POST /api/admin/provision (orchestrator#262, Phase C C-2):
	// tenant registry row → a pending workspace INVITE for the first user, whose
	// account + sign-in email go through provisioning's identity invite API → license
	// mint. That API never reveals whether the account already existed or whether an
	// email went out, so this page states neither. The per-app licence tokens are
	// ONE-TIME: the operator must copy them now, they are never re-fetchable. Gated by the (platform)
	// group layout; the server 403s on its own too.
	import { resolve } from '$app/paths';
	import { admin, type ProvisionUserResult } from '$lib/api';
	import { tenancyErrorMessage } from '$lib/api/tenancy.js';
	import { Card, Button, Input, Select, ErrorState } from '$lib/components/ui';
	import type { LlmAccessMode } from '$lib/api/providers.js';
	import {
		DEFAULT_LLM_ACCESS,
		LLM_ACCESS_LABELS,
		isLlmAccessMode
	} from '$lib/components/providers/llm-access.js';
	import LlmAccessSelect from '$lib/components/providers/LlmAccessSelect.svelte';

	let email = $state('');
	let name = $state('');
	let tenantSlug = $state('');
	let workspaceRole = $state<'member' | 'tenant_admin'>('tenant_admin');
	// Sent explicitly (all three modes are provisionable): without it licences would
	// make the new tenant `byo_required` and block its runs until it registers providers.
	let llmAccess = $state<LlmAccessMode | ''>(DEFAULT_LLM_ACCESS);

	let submitting = $state(false);
	let error = $state<string | null>(null);
	let result = $state<ProvisionUserResult | null>(null);
	let copiedKey = $state<string | null>(null);

	const SLUG_RE = /^[a-z0-9-]{2,40}$/;
	const slugValid = $derived(SLUG_RE.test(tenantSlug));
	const canSubmit = $derived(
		!submitting && email.trim().length > 2 && name.trim().length > 0 && slugValid
	);

	async function submit(): Promise<void> {
		if (!canSubmit) return;
		submitting = true;
		error = null;
		try {
			result = await admin.provisionUser({
				email: email.trim(),
				name: name.trim(),
				tenant_slug: tenantSlug.trim(),
				workspace_role: workspaceRole,
				llm_access: isLlmAccessMode(llmAccess) ? llmAccess : DEFAULT_LLM_ACCESS
			});
		} catch (e) {
			error = tenancyErrorMessage(e, 'Provisioning failed. Check the inputs and retry.');
		} finally {
			submitting = false;
		}
	}

	async function copy(key: string, value: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(value);
			copiedKey = key;
			setTimeout(() => (copiedKey = null), 1500);
		} catch {
			// Clipboard may be unavailable (insecure context / test env) — non-fatal.
		}
	}

	function reset(): void {
		result = null;
		error = null;
		email = '';
		name = '';
		tenantSlug = '';
		llmAccess = DEFAULT_LLM_ACCESS;
	}
</script>

<Page width="narrow" testid="provision-home">
	<PageHeader
		kicker="Platform"
		title="Provision tenant"
		subtitle="Onboard a new tenant and its first user. The user gets a workspace invite; you get one-time license tokens to hand over — they can't be retrieved again."
	/>

	{#if result}
		<!-- One-time credentials panel -->
		<Card class="p-5">
			<div data-testid="provision-result" class="flex flex-col gap-4">
				<div>
					<p class="text-sm font-medium text-[var(--color-text)]">Tenant provisioned</p>
					<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
						<dt class="text-[var(--color-text-muted)]">Tenant ID</dt>
						<dd class="font-mono">{result.tenant_id}</dd>
					</dl>
				</div>

				{#if result.llm_access?.status === 'failed'}
					<div
						class="rounded-[var(--radius-md)] border border-status-pending/40 bg-status-pending/10 p-3 text-sm text-[var(--color-text)]"
						role="alert"
						data-testid="provision-llm-access-failed"
					>
						<p class="font-semibold">Service access was not set</p>
						<p class="mt-1 break-words">
							The tenant was created, but setting its Service access to
							<strong>{LLM_ACCESS_LABELS[result.llm_access.mode] ?? result.llm_access.mode}</strong>
							failed{result.llm_access.detail ? `: ${result.llm_access.detail}` : '.'} Set it on the
							<a class="underline" href={resolve('/tenants')}>Tenants</a> page — until then its runs may
							be blocked.
						</p>
					</div>
				{:else if result.llm_access?.status === 'ok'}
					<p class="text-xs text-[var(--color-text-muted)]" data-testid="provision-llm-access-ok">
						Service access: {LLM_ACCESS_LABELS[result.llm_access.mode] ?? result.llm_access.mode}
					</p>
				{/if}

				<div data-testid="provision-invite">
					<p class="mb-1 text-xs font-medium text-[var(--color-text-muted)]">Workspace invite</p>
					{#if result.invite_id}
						<p class="text-sm text-[var(--color-text)]" data-testid="provision-invite-notice">
							Invitation sent if the address can receive one; the user signs in from the link.
						</p>
						<p class="mt-1 text-xs text-[var(--color-text-muted)]">
							Invite pending for <strong>{email.trim() || 'the user'}</strong>.
						</p>
						<p class="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
							Invite ID {result.invite_id}
						</p>
					{:else}
						<p class="text-sm text-[var(--color-text)]">
							No invite needed — this user is already an active member of the workspace.
						</p>
					{/if}
				</div>

				{#each Object.entries(result.tokens ?? {}) as [appKey, token] (appKey)}
					<div data-testid="provision-token">
						<p class="mb-1 text-xs font-medium text-[var(--color-text-muted)]">
							License token — {appKey}
						</p>
						<div
							class="flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] p-2"
						>
							<code class="truncate text-sm">{token}</code>
							<Button variant="ghost" size="sm" onclick={() => copy(`token-${appKey}`, token)}>
								{copiedKey === `token-${appKey}` ? 'Copied' : 'Copy'}
							</Button>
						</div>
					</div>
				{/each}

				<div class="flex justify-end">
					<Button variant="primary" size="sm" onclick={reset}>Provision another</Button>
				</div>
			</div>
		</Card>
	{:else}
		<Card class="p-5">
			<form
				class="flex flex-col gap-4"
				data-testid="provision-form"
				onsubmit={(e) => {
					e.preventDefault();
					void submit();
				}}
			>
				{#if error}
					<ErrorState title="Couldn't provision" {error} />
				{/if}
				<Input
					name="email"
					label="Email"
					type="email"
					placeholder="user@example.com"
					bind:value={email}
				/>
				<Input name="name" label="Full name" placeholder="Ada Lovelace" bind:value={name} />
				<div>
					<Input
						name="tenant_slug"
						label="Tenant slug"
						placeholder="acme-corp"
						bind:value={tenantSlug}
					/>
					{#if tenantSlug && !slugValid}
						<p class="mt-1 text-xs text-[var(--color-danger)]" data-testid="slug-error">
							Lowercase letters, digits and hyphens only (2–40 chars).
						</p>
					{/if}
				</div>
				<Select
					name="workspace_role"
					label="Workspace role"
					bind:value={workspaceRole}
					options={[
						{ value: 'tenant_admin', label: 'Tenant admin' },
						{ value: 'member', label: 'Member' }
					]}
				/>
				<div data-testid="provision-llm-access">
					<LlmAccessSelect name="llm_access" bind:value={llmAccess} />
				</div>
				<div class="flex justify-end">
					<Button type="submit" variant="primary" loading={submitting} disabled={!canSubmit}>
						Provision
					</Button>
				</div>
			</form>
		</Card>
	{/if}
</Page>
