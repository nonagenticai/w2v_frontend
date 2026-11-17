<script lang="ts">
	// Workspace switcher (P2 tenancy). EVERY user can switch between the
	// workspaces they are a member of (`/auth/me.memberships`); a super_admin can
	// additionally act AS any switchable tenant (the platform list from /admin/tenants). The
	// selection is sent as `X-Active-Tenant-Id` on every request (tenant-switcher
	// store → api client) and the orchestrator re-scopes the whole app. A full
	// reload re-runs every page's in-component `$effect` fetch under the new scope.
	//
	// Non-super callers only ever see their own memberships — the backend refuses
	// any other tenant (NO_MEMBERSHIP), so offering one would be a dead option.
	import { getUser, isSuperAdmin } from '$lib/stores/auth.svelte.js';
	import { tenantSwitcher } from '$lib/stores/tenant-switcher.svelte.js';
	import { admin, type AdminTenantSummary } from '$lib/api/admin.js';
	import { Select } from '$lib/components/ui';
	import { tenantLabel } from '$lib/utils/tenant-label';

	// Statuses the backend refuses a scope-switch into (OPERATOR_HELD_TENANT_STATUSES).
	// Only a fallback for an orchestrator that predates `switchable`.
	const HELD_STATUSES = new Set(['suspended', 'deleted']);

	const isSuper = $derived(isSuperAdmin());
	const user = $derived(getUser());
	const memberships = $derived(user?.memberships ?? []);

	let platformTenants = $state<AdminTenantSummary[]>([]);

	// super_admin only: the cross-tenant list. On failure the switcher degrades
	// to the caller's memberships.
	$effect(() => {
		if (!isSuper) return;
		let cancelled = false;
		admin
			.tenants()
			.then((res) => {
				if (!cancelled) platformTenants = res.items;
			})
			.catch(() => {
				/* degrade to memberships only */
			});
		return () => {
			cancelled = true;
		};
	});

	const memberIds = $derived(new Set(memberships.map((m) => m.tenant_id)));

	// The picker offers ONLY tenants the backend will serve: a suspended or
	// deleted tenant is listed on the platform screen but never switchable, and
	// offering it here locked the super_admin into an empty shell (every request
	// 404 TENANT_NOT_FOUND).
	function isSwitchable(t: AdminTenantSummary): boolean {
		if (typeof t.switchable === 'boolean') return t.switchable;
		return !HELD_STATUSES.has(t.status ?? 'active');
	}

	function membershipLabel(name: string | null | undefined, id: string, role: string): string {
		const base = tenantLabel({ tenant_id: id, name });
		return role === 'tenant_admin' ? `${base} · admin` : base;
	}

	const options = $derived([
		...(isSuper ? [{ value: '', label: 'Self (own workspace)' }] : []),
		...memberships.map((m) => ({
			value: m.tenant_id,
			label: membershipLabel(m.name, m.tenant_id, m.role)
		})),
		...(isSuper
			? platformTenants
					.filter((t) => !memberIds.has(t.tenant_id) && isSwitchable(t))
					.map((t) => ({ value: t.tenant_id, label: tenantLabel(t) }))
			: [])
	]);

	const acting = $derived(tenantSwitcher.activeTenantId);
	// What the select shows: the explicit choice, else the tenant the backend
	// resolved for this session (most-recently-used membership). A super_admin's
	// "Self" is the empty value.
	const selected = $derived(acting ?? (isSuper ? '' : (user?.tenant_id ?? '')));

	// A super_admin acting into a tenant they are NOT a member of gets a visible
	// warning badge — that is the audited cross-tenant case.
	const foreignActing = $derived(isSuper && acting !== null && !memberIds.has(acting));
	const actingLabel = $derived(
		acting
			? tenantLabel(
					platformTenants.find((t) => t.tenant_id === acting) ?? { tenant_id: acting, name: null }
				)
			: ''
	);

	// Show a picker when there is a choice to make; one workspace is a label.
	// Claim mode (`W2V_TENANCY_SOURCE=claim`) reports `role: null` and the backend
	// IGNORES `X-Active-Tenant-Id` for non-super callers there — a picker would
	// switch nothing, so it only appears when membership tenancy is in force.
	const showPicker = $derived(isSuper || (memberships.length > 1 && user?.role != null));
	const single = $derived(!isSuper && memberships.length === 1 ? memberships[0] : null);

	async function onSwitch(e: Event): Promise<void> {
		const next = (e.target as HTMLSelectElement).value || null;
		if (next === selected || (next === null && selected === '')) return;
		// A super_admin's deliberate switch is recorded (best-effort, never blocks
		// the switch). Membership switches need no audit row — they are the
		// caller's own workspaces.
		if (isSuper) {
			try {
				await admin.recordScopeSwitch(next);
			} catch {
				/* best-effort audit; proceed with the switch regardless */
			}
		}
		tenantSwitcher.setActive(next);
		if (typeof window !== 'undefined') window.location.reload();
	}
</script>

{#if showPicker}
	<div class="hidden items-center gap-2 md:flex" data-testid="tenant-switcher">
		{#if foreignActing}
			<span
				class="rounded-full bg-[var(--color-warning-bg,var(--color-surface-strong))] px-2 py-0.5 text-xs font-medium text-[var(--color-warning,var(--color-text-muted))]"
				data-testid="tenant-switcher-acting"
			>
				Acting as {actingLabel}
			</span>
		{/if}
		<Select
			name="active-tenant"
			value={selected}
			{options}
			placeholder=""
			onchange={onSwitch}
			class="min-w-[12rem]"
		/>
	</div>
{:else if single}
	<span
		class="hidden truncate text-sm text-[var(--color-text-muted)] md:inline"
		data-testid="tenant-switcher-single"
	>
		{tenantLabel(single)}
	</span>
{/if}
