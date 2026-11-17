<script lang="ts">
	// Early-access onboarding (super_admin only) — the review queue for people who
	// asked for early access, plus a direct "invite to early access" form. Backed
	// by /api/admin/signup-approvals (orchestrator `signup_approvals.py`).
	//
	// A super-admin can also REMOVE an approved early-access workspace end to end
	// (POST …/{id}/remove, orchestrator `services/signup/removal.py`): the slug is
	// typed back to confirm; the removal's steps, blockers, Retry and Resolve
	// show on the request. Remove and Retry only QUEUE the removal (202): the
	// orchestrator's background pass runs it, and the open request is re-read
	// every few seconds while it is queued / running.
	//
	// URL: /admin/onboarding — Telegram's "Open in w2v" button deep-links to
	// /admin/onboarding?signup=<id>, which opens that request's detail panel. It
	// lives in the (platform) group, so the group layout's super_admin guard
	// applies; (tenant)/admin owns only the bare /admin page, so the two never
	// collide. The server 403s non-super_admin callers on its own.
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	import {
		signupApprovals,
		SIGNUP_LOCALES,
		type SignupApproval,
		type SignupApproveResult,
		type SignupListFilter,
		type SignupLlmAccess,
		type SignupLocale
	} from '$lib/api/signup-approvals.js';
	import LlmAccessSelect from '$lib/components/providers/LlmAccessSelect.svelte';
	import {
		DEFAULT_LLM_ACCESS,
		LLM_ACCESS_LABELS,
		isLlmAccessMode
	} from '$lib/components/providers/llm-access.js';
	import type { LlmAccessMode } from '$lib/api/providers.js';
	import {
		Button,
		Card,
		Dialog,
		EmptyState,
		ErrorState,
		Input,
		Pill,
		Select,
		Skeleton,
		Tabs
	} from '$lib/components/ui';
	import {
		FILTER_ITEMS,
		NOT_CONFIGURED_MESSAGE,
		RETRY_UNCERTAIN_WARNING,
		canDecide,
		canRemove,
		canResolveRemoval,
		canRetry,
		canRetryRemoval,
		isUuid,
		legacyLoginCorrectable,
		REMOVAL_POLL_MS,
		removalCodeMessage,
		removalInFlight,
		removalNeedsAttention,
		removalProgressText,
		removalStaleText,
		EVIDENCE_FINGERPRINT_NOTE,
		REMOVE_STOP_NOTE,
		RESOLVE_ERASE_WARNING,
		removalDoneNotice,
		resolvedText,
		removalStepRows,
		removeConfirmReady,
		emailUncertain,
		existingSignupId,
		formatDate,
		isNotConfigured,
		isValidEmail,
		localeLabel,
		parseFilter,
		requestStatusView,
		signupErrorMessage,
		sourceLabel,
		stepRows
	} from '$lib/components/onboarding/signup-onboarding.js';

	// ── queue ─────────────────────────────────────────────────────────────
	let filter = $state<SignupListFilter>('pending');
	let items = $state<SignupApproval[]>([]);
	let loading = $state(true);
	let listError = $state<string | null>(null);
	let notConfigured = $state(false);

	// ── detail ────────────────────────────────────────────────────────────
	let selectedId = $state<string | null>(null);
	let selected = $state<SignupApproval | null>(null);
	let detailLoading = $state(false);
	let detailError = $state<string | null>(null);
	let actionError = $state<string | null>(null);
	let actionNotice = $state<string | null>(null);
	let busy = $state<'approve' | 'reject' | 'retry' | 'remove' | 'removal_retry' | 'resolve' | null>(
		null
	);
	let workspaceName = $state('');
	// The approver's per-person Service access (CommonPractice's plan choice). The
	// select pre-selects the deployment default the list reports
	// (`defaultLlmAccess` = W2V_SIGNUP_LLM_ACCESS); it is SENT only when the operator
	// changed it, so an untouched choice is the server's default, not ours.
	let defaultLlmAccess = $state<SignupLlmAccess>(DEFAULT_LLM_ACCESS);
	let approveLlmAccess = $state<LlmAccessMode | ''>(DEFAULT_LLM_ACCESS);
	let approveLlmTouched = $state(false);
	let confirmRejectOpen = $state(false);
	let confirmRetryOpen = $state(false);
	// ── removal ──
	let confirmRemoveOpen = $state(false);
	let removeSlug = $state('');
	let legacyUserId = $state('');
	let legacyEvidence = $state('');
	let allowCredentialedDelete = $state(false);
	let confirmResolveOpen = $state(false);
	let resolveNote = $state('');
	let resolveAck = $state(false);
	/** The request whose queued removal / retry the operator just started: its
	 *  outcome replaces the "queued" notice once a poll sees it finish. */
	let watchingRemoval = $state<string | null>(null);
	/** Bumped after every poll, so the next one is scheduled even when nothing changed. */
	let pollTick = $state(0);
	/** Bumped on every detail load / selection: only the newest response may land. */
	let detailSeq = 0;

	// ── invite ────────────────────────────────────────────────────────────
	let inviteEmail = $state('');
	let inviteName = $state('');
	let inviteCompany = $state('');
	let inviteLocale = $state<SignupLocale>('en');
	let inviteLlmAccess = $state<LlmAccessMode | ''>(DEFAULT_LLM_ACCESS);
	let inviteLlmTouched = $state(false);
	let inviting = $state(false);
	let inviteError = $state<string | null>(null);
	let inviteNotice = $state<string | null>(null);
	/** The existing request behind a 409 `early_access_workspace_exists`. */
	let inviteExistingId = $state<string | null>(null);

	/** The select's value as a wire value (all three modes are accepted). */
	function llmChoice(v: LlmAccessMode | ''): SignupLlmAccess {
		return isLlmAccessMode(v) ? v : DEFAULT_LLM_ACCESS;
	}

	const localeOptions = SIGNUP_LOCALES.map((l) => ({ value: l, label: localeLabel(l) }));
	const inviteEmailValid = $derived(isValidEmail(inviteEmail));
	const canInvite = $derived(
		!inviting && !notConfigured && inviteEmailValid && inviteName.trim().length > 0
	);

	function syncUrl(): void {
		const parts: string[] = [];
		if (filter !== 'pending') parts.push(`status=${encodeURIComponent(filter)}`);
		if (selectedId) parts.push(`signup=${encodeURIComponent(selectedId)}`);
		const base = resolve('/admin/onboarding');
		try {
			// Query-only variant of a resolved route — resolve() can't type the query.
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			replaceState(parts.length ? `${base}?${parts.join('&')}` : base, {});
		} catch {
			// Before the router is ready (first mount) a shallow replace may throw — non-fatal.
		}
	}

	async function loadList(): Promise<void> {
		loading = true;
		listError = null;
		try {
			const res = await signupApprovals.list(filter);
			items = res.items ?? [];
			adoptDefaultLlmAccess(res.defaultLlmAccess);
			notConfigured = false;
		} catch (e) {
			items = [];
			if (isNotConfigured(e)) notConfigured = true;
			else listError = signupErrorMessage(e, 'Could not load sign-up requests.');
		} finally {
			loading = false;
		}
	}

	/** The server's default for an untouched choice; untouched selects follow it. */
	function adoptDefaultLlmAccess(d: unknown): void {
		if (!isLlmAccessMode(d)) return;
		defaultLlmAccess = d;
		if (!approveLlmTouched) approveLlmAccess = d;
		if (!inviteLlmTouched) inviteLlmAccess = d;
	}

	function show(row: SignupApproval): void {
		if (selected?.id !== row.id) {
			approveLlmAccess = defaultLlmAccess;
			approveLlmTouched = false;
		}
		selected = row;
		workspaceName = row.suggested_tenant_name ?? '';
	}

	/** True while `id` is still the request the operator has open. */
	function isCurrent(id: string): boolean {
		return selectedId === id;
	}

	async function loadDetail(id: string): Promise<void> {
		const seq = ++detailSeq;
		detailLoading = true;
		detailError = null;
		try {
			const row = await signupApprovals.get(id);
			// A newer selection (or load) started meanwhile: this answer is stale.
			if (seq !== detailSeq || !isCurrent(id)) return;
			show(row);
		} catch (e) {
			if (seq !== detailSeq || !isCurrent(id)) return;
			selected = null;
			if (isNotConfigured(e)) notConfigured = true;
			else detailError = signupErrorMessage(e, 'Could not load this request.');
		} finally {
			if (seq === detailSeq) detailLoading = false;
		}
	}

	function openById(id: string): void {
		selectedId = id;
		selected = null;
		detailError = null;
		actionError = null;
		actionNotice = null;
		syncUrl();
		void loadDetail(id);
	}

	function select(row: SignupApproval): void {
		selectedId = row.id;
		actionError = null;
		actionNotice = null;
		detailError = null;
		show(row);
		syncUrl();
		// Refresh from the server: the list row may be stale by the time it's opened.
		void loadDetail(row.id);
	}

	function closeDetail(): void {
		detailSeq++;
		selectedId = null;
		selected = null;
		detailError = null;
		actionError = null;
		actionNotice = null;
		syncUrl();
	}

	function changeFilter(next: string): void {
		filter = next as SignupListFilter;
		syncUrl();
		void loadList();
	}

	/** Put an updated row back into the queue (or drop it when it left the filter).
	 *  The detail panel only takes it when it is still the open request. */
	function replaceRow(row: SignupApproval): void {
		if (isCurrent(row.id)) {
			detailSeq++; // an in-flight GET for this row is older than this answer
			show(row);
		}
		const keep =
			filter === row.status ||
			(filter === 'needs_attention' &&
				((row.status === 'approved' && row.steps_not_ok.length > 0) || removalNeedsAttention(row)));
		items = keep
			? items.map((r) => (r.id === row.id ? row : r))
			: items.filter((r) => r.id !== row.id);
	}

	function approvedNotice(res: SignupApproveResult, who: string): string {
		const ws = res.tenant?.name ? `Workspace “${res.tenant.name}” is ready.` : '';
		if (res.emailState === 'sent') return `${who} approved. ${ws} The welcome email has been sent.`;
		const notOk = res.stepsNotOk ?? [];
		if (notOk.some((s) => s.status === 'unknown' || s.status === 'in_flight'))
			return `${who} approved. ${ws} We couldn’t confirm the welcome email went out — see the steps below.`;
		if (notOk.some((s) => s.status === 'failed'))
			return `${who} approved, but setup is not finished yet — see the steps below.`;
		return `${who} approved. ${ws} The welcome email goes out once setup finishes.`;
	}

	async function approve(): Promise<void> {
		const id = selectedId;
		if (!id || !selected || selected.id !== id || busy) return;
		const row = selected;
		busy = 'approve';
		actionError = null;
		actionNotice = null;
		const name = workspaceName.trim();
		const custom = name && name !== row.suggested_tenant_name ? name : undefined;
		try {
			const res = await signupApprovals.approve(
				id,
				custom,
				approveLlmTouched ? llmChoice(approveLlmAccess) : undefined
			);
			replaceRow(res.approval);
			if (isCurrent(id)) actionNotice = approvedNotice(res, row.name || row.email);
		} catch (e) {
			if (isNotConfigured(e)) notConfigured = true;
			if (isCurrent(id)) actionError = signupErrorMessage(e, 'Could not approve this request.');
		} finally {
			busy = null;
		}
	}

	async function confirmReject(): Promise<void> {
		confirmRejectOpen = false;
		const id = selectedId;
		if (!id || !selected || selected.id !== id || busy) return;
		const row = selected;
		busy = 'reject';
		actionError = null;
		actionNotice = null;
		try {
			replaceRow(await signupApprovals.reject(id));
			if (isCurrent(id)) actionNotice = `${row.name || row.email}'s request was declined.`;
		} catch (e) {
			if (isNotConfigured(e)) notConfigured = true;
			if (isCurrent(id)) actionError = signupErrorMessage(e, 'Could not decline this request.');
		} finally {
			busy = null;
		}
	}

	/** Retry, but first make the operator confirm when the earlier email may have gone out. */
	function requestRetry(): void {
		if (selected && emailUncertain(selected)) confirmRetryOpen = true;
		else void retry();
	}

	async function retry(): Promise<void> {
		confirmRetryOpen = false;
		const id = selectedId;
		if (!id || !selected || selected.id !== id || busy) return;
		busy = 'retry';
		actionError = null;
		actionNotice = null;
		try {
			const row = await signupApprovals.retry(id);
			replaceRow(row);
			if (isCurrent(id))
				actionNotice =
					row.steps_not_ok.length === 0
						? 'Setup finished. Every step is done.'
						: 'Retried. Some steps still need attention — see below.';
		} catch (e) {
			if (isNotConfigured(e)) notConfigured = true;
			if (isCurrent(id)) actionError = signupErrorMessage(e, 'Could not retry the setup.');
		} finally {
			busy = null;
		}
	}

	function openRemove(): void {
		removeSlug = '';
		legacyUserId = '';
		legacyEvidence = '';
		allowCredentialedDelete = false;
		confirmRemoveOpen = true;
	}

	const removeReady = $derived(
		!!selected && removeConfirmReady(selected, removeSlug, legacyUserId, legacyEvidence)
	);

	async function confirmRemove(): Promise<void> {
		const id = selectedId;
		if (!id || !selected || selected.id !== id || busy || !removeReady) return;
		const legacy = selected.needs_legacy_identity
			? { user_id: legacyUserId.trim(), evidence: legacyEvidence.trim() }
			: undefined;
		confirmRemoveOpen = false;
		busy = 'remove';
		actionError = null;
		actionNotice = null;
		try {
			const row = await signupApprovals.remove(id, {
				confirm: removeSlug.trim(),
				legacy_identity: legacy,
				allow_credentialed_delete: legacy ? allowCredentialedDelete : undefined
			});
			replaceRow(row);
			watchingRemoval = id;
			if (isCurrent(id)) actionNotice = removalNotice(row);
		} catch (e) {
			if (isNotConfigured(e)) notConfigured = true;
			if (isCurrent(id))
				actionError = signupErrorMessage(e, 'Could not remove this early-access workspace.');
		} finally {
			busy = null;
		}
	}

	function removalNotice(row: SignupApproval): string {
		switch (row.removal?.state) {
			case 'done':
				return row.removal
					? removalDoneNotice(row.removal)
					: 'The early-access workspace was removed.';
			case 'blocked':
				return 'The removal stopped — see why below. Steps already marked done stay done.';
			case 'failed':
				return 'The removal gave up after repeated failures — see the steps below.';
			case 'resolved_manually':
				return 'The removal was closed by hand. The address can sign up again.';
			default:
				return 'The removal is queued and runs in the background — the steps below update on their own.';
		}
	}

	/** Re-read the open request while its removal is queued / running. */
	async function pollRemoval(id: string): Promise<void> {
		try {
			if (busy || !isCurrent(id)) return;
			const row = await signupApprovals.get(id);
			if (!isCurrent(id)) return;
			replaceRow(row);
			if (watchingRemoval === id && !removalInFlight(row)) {
				watchingRemoval = null;
				actionNotice = removalNotice(row);
			}
		} catch {
			// The next poll tries again; a lasting failure shows on the next action.
		} finally {
			pollTick++;
		}
	}

	$effect(() => {
		void pollTick;
		const id = selected && removalInFlight(selected) ? selected.id : null;
		if (!id) return;
		const timer = setTimeout(() => void pollRemoval(id), REMOVAL_POLL_MS);
		return () => clearTimeout(timer);
	});

	/** A legacy login check stopped the removal: let the operator correct it. */
	const legacyCorrectable = $derived(!!selected && legacyLoginCorrectable(selected));

	async function retryRemoval(): Promise<void> {
		const id = selectedId;
		if (!id || !selected || selected.id !== id || busy) return;
		const correction =
			legacyCorrectable && isUuid(legacyUserId) && legacyEvidence.trim().length >= 3
				? {
						legacy_identity: { user_id: legacyUserId.trim(), evidence: legacyEvidence.trim() },
						allow_credentialed_delete: allowCredentialedDelete
					}
				: undefined;
		busy = 'removal_retry';
		actionError = null;
		actionNotice = null;
		try {
			const row = await signupApprovals.retryRemoval(id, correction);
			replaceRow(row);
			watchingRemoval = id;
			if (isCurrent(id)) actionNotice = removalNotice(row);
		} catch (e) {
			if (isNotConfigured(e)) notConfigured = true;
			if (isCurrent(id)) actionError = signupErrorMessage(e, 'Could not retry the removal.');
		} finally {
			busy = null;
		}
	}

	function openResolve(): void {
		resolveNote = '';
		resolveAck = false;
		confirmResolveOpen = true;
	}

	async function confirmResolve(): Promise<void> {
		const id = selectedId;
		if (!id || !selected || selected.id !== id || busy) return;
		if (!resolveAck || resolveNote.trim().length < 3) return;
		confirmResolveOpen = false;
		busy = 'resolve';
		actionError = null;
		actionNotice = null;
		try {
			const row = await signupApprovals.resolveRemoval(id, resolveNote.trim());
			replaceRow(row);
			if (isCurrent(id))
				actionNotice = 'The removal was closed by hand. The address can sign up again.';
		} catch (e) {
			if (isNotConfigured(e)) notConfigured = true;
			if (isCurrent(id)) actionError = signupErrorMessage(e, 'Could not close the removal.');
		} finally {
			busy = null;
		}
	}

	async function invite(): Promise<void> {
		if (!canInvite) return;
		inviting = true;
		inviteError = null;
		inviteNotice = null;
		inviteExistingId = null;
		const who = inviteName.trim();
		try {
			const res = await signupApprovals.invite({
				email: inviteEmail.trim(),
				name: who,
				company: inviteCompany.trim() || null,
				locale: inviteLocale,
				...(inviteLlmTouched ? { llmAccess: llmChoice(inviteLlmAccess) } : {})
			});
			inviteNotice =
				(res.reusedPending ? `${who} already had a request waiting — it has been approved. ` : '') +
				approvedNotice(res, who);
			inviteEmail = '';
			inviteName = '';
			inviteCompany = '';
			inviteLocale = 'en';
			inviteLlmAccess = defaultLlmAccess;
			inviteLlmTouched = false;
			detailSeq++;
			selectedId = res.approval.id;
			actionError = null;
			actionNotice = null;
			detailError = null;
			show(res.approval);
			syncUrl();
			void loadList();
		} catch (e) {
			if (isNotConfigured(e)) notConfigured = true;
			inviteError = signupErrorMessage(e, 'Could not send the invitation.');
			inviteExistingId = existingSignupId(e);
		} finally {
			inviting = false;
		}
	}

	onMount(() => {
		const params = $page.url.searchParams;
		filter = parseFilter(params.get('status'));
		const fromUrl = params.get('signup');
		void loadList();
		if (fromUrl) openById(fromUrl);
	});

	const steps = $derived(selected ? stepRows(selected) : []);
	const removalSteps = $derived(selected?.removal ? removalStepRows(selected) : []);
	const statusView = $derived(selected ? requestStatusView(selected) : null);
</script>

<Page width="wide" testid="onboarding-home">
	<PageHeader
		kicker="Platform"
		title="Early access"
		subtitle="Review early-access requests and invite people directly. Approving creates their workspace and sends a welcome email in their language."
	/>

	{#if notConfigured}
		<div
			class="rounded-[var(--radius-md)] border border-status-pending/40 bg-status-pending/10 p-4 text-sm text-[var(--color-text)]"
			role="status"
			data-testid="onboarding-not-configured"
		>
			<p class="font-semibold">Early-access sign-up is not enabled</p>
			<p class="mt-1">{NOT_CONFIGURED_MESSAGE}</p>
		</div>
	{/if}

	<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
		<!-- ── queue ── -->
		<section class="flex min-w-0 flex-col gap-4" aria-label="Requests">
			<Tabs items={[...FILTER_ITEMS]} value={filter} onValueChange={changeFilter} />

			{#if loading}
				<div data-testid="onboarding-loading">
					<Card class="p-2">
						<Skeleton variant="text" count={4} height="2.25rem" />
					</Card>
				</div>
			{:else if listError}
				<ErrorState title="Couldn't load requests" error={listError} onRetry={loadList} />
			{:else if notConfigured}
				<!-- banner above says why -->
			{:else if items.length === 0}
				<EmptyState
					title="Nothing here"
					description={filter === 'pending'
						? 'No one is waiting for review. New requests appear here as they arrive.'
						: 'No requests match this filter.'}
				/>
			{:else}
				<Card>
					<ul class="divide-y divide-[var(--color-border)]" data-testid="onboarding-list">
						{#each items as row (row.id)}
							{@const view = requestStatusView(row)}
							<li data-testid="onboarding-row">
								<button
									type="button"
									class={`flex w-full flex-col gap-1 p-4 text-left hover:bg-[var(--color-surface-strong)] ${
										selectedId === row.id ? 'bg-[var(--color-surface-strong)]' : ''
									}`}
									aria-current={selectedId === row.id ? 'true' : undefined}
									onclick={() => select(row)}
								>
									<span class="flex items-center justify-between gap-3">
										<span class="truncate text-sm font-medium text-[var(--color-text)]"
											>{row.name}</span
										>
										<Pill tone={view.tone}>{view.label}</Pill>
									</span>
									<span class="truncate text-sm text-[var(--color-text-muted)]">{row.email}</span>
									<span
										class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]"
									>
										{#if row.company}<span>{row.company}</span>{/if}
										<span>{sourceLabel(row.source)}</span>
										<span>{localeLabel(row.locale)}</span>
										<span>{formatDate(row.created_at)}</span>
									</span>
								</button>
							</li>
						{/each}
					</ul>
				</Card>
			{/if}
		</section>

		<!-- ── detail ── -->
		<section class="flex min-w-0 flex-col gap-4" aria-label="Request details">
			{#if selectedId}
				<Card class="p-5">
					<div class="flex flex-col gap-4" data-testid="onboarding-detail">
						{#if detailLoading && !selected}
							<Skeleton variant="text" count={4} height="1.5rem" />
						{:else if detailError}
							<ErrorState
								title="Couldn't load this request"
								error={detailError}
								onRetry={() => selectedId && loadDetail(selectedId)}
							/>
						{:else if selected}
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<h2 class="truncate text-lg font-semibold text-[var(--color-text)]">
										{selected.name}
									</h2>
									<p class="truncate text-sm text-[var(--color-text-muted)]">{selected.email}</p>
								</div>
								<div class="flex items-center gap-2">
									{#if statusView}<Pill tone={statusView.tone}>{statusView.label}</Pill>{/if}
									<Button variant="ghost" size="sm" onclick={closeDetail}>Close</Button>
								</div>
							</div>

							<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
								<dt class="text-[var(--color-text-muted)]">Company</dt>
								<dd>{selected.company || '—'}</dd>
								<dt class="text-[var(--color-text-muted)]">Came from</dt>
								<dd>{sourceLabel(selected.source)}</dd>
								<dt class="text-[var(--color-text-muted)]">Email language</dt>
								<dd>{localeLabel(selected.locale)}</dd>
								<dt class="text-[var(--color-text-muted)]">Requested</dt>
								<dd>{formatDate(selected.created_at)}</dd>
								{#if selected.llm_access}
									<dt class="text-[var(--color-text-muted)]">Service access</dt>
									<dd data-testid="onboarding-llm-access">
										{LLM_ACCESS_LABELS[selected.llm_access] ?? selected.llm_access}
									</dd>
								{/if}
								{#if selected.decided_at}
									<dt class="text-[var(--color-text-muted)]">Decided</dt>
									<dd>
										{formatDate(selected.decided_at)}{selected.decided_via === 'telegram'
											? ' (from Telegram)'
											: ''}
									</dd>
								{/if}
							</dl>

							<div>
								<p class="mb-1 text-xs font-medium text-[var(--color-text-muted)]">Their message</p>
								{#if selected.message}
									<p
										class="whitespace-pre-line rounded-md border border-[var(--color-border)] p-3 text-sm"
										data-testid="onboarding-message"
									>
										{selected.message}
									</p>
								{:else}
									<p class="text-sm text-[var(--color-text-muted)]">No message.</p>
								{/if}
							</div>

							{#if selected.status === 'approved' && selected.tenant_id}
								<p class="text-sm" data-testid="onboarding-tenant">
									Workspace:
									<a class="underline" href={resolve('/tenants')}
										>{selected.tenant_name || selected.tenant_slug || selected.tenant_id}</a
									>
									{#if selected.tenant_slug}<span class="text-[var(--color-text-muted)]">
											({selected.tenant_slug})</span
										>{/if}
								</p>
							{/if}

							{#if selected.status === 'approved'}
								<div data-testid="onboarding-steps">
									<p class="mb-2 text-xs font-medium text-[var(--color-text-muted)]">Setup</p>
									<ol class="flex flex-col gap-2">
										{#each steps as s (s.step)}
											<li class="flex flex-col gap-0.5" data-testid="onboarding-step">
												<span class="flex items-center justify-between gap-3 text-sm">
													<span>{s.label}</span>
													<Pill tone={s.tone}>{s.statusLabel}</Pill>
												</span>
												{#if s.summary}
													<span
														class="break-words text-xs text-[var(--color-text-muted)]"
														data-testid="onboarding-step-summary">{s.summary}</span
													>
													{#if s.error}
														<details class="text-xs text-[var(--color-text-muted)]">
															<summary class="cursor-pointer">Technical details</summary>
															<code
																class="mt-1 block whitespace-pre-wrap break-words"
																data-testid="onboarding-step-error">{s.error}</code
															>
														</details>
													{/if}
												{/if}
											</li>
										{/each}
									</ol>
									{#if selected.steps_next_attempt_at && selected.steps_not_ok.length > 0}
										<p class="mt-2 text-xs text-[var(--color-text-muted)]">
											Next automatic retry: {formatDate(selected.steps_next_attempt_at)}
										</p>
									{/if}
									{#if emailUncertain(selected)}
										<p
											class="mt-2 text-xs text-[var(--color-text)]"
											data-testid="onboarding-email-uncertain"
										>
											We couldn't confirm whether the welcome email went out. It is not re-sent
											automatically — check with the person first. Retry sends another email; the
											link in any earlier email keeps working.
										</p>
									{/if}
								</div>
							{/if}

							{#if selected.status === 'removed' && selected.removal}
								{@const rm = selected.removal}
								<div data-testid="onboarding-removal">
									<p class="mb-1 text-xs font-medium text-[var(--color-text-muted)]">
										Removal of the early-access workspace{rm.tenant_slug
											? ` (${rm.tenant_slug})`
											: ''}
									</p>
									{#if rm.blockers.length > 0}
										<ul
											class="mb-2 flex flex-col gap-1 rounded-md border border-[var(--color-danger)]/40 p-3 text-sm"
											data-testid="onboarding-removal-blockers"
										>
											{#each rm.blockers as b (b.code)}
												<li>
													{removalCodeMessage(b.code) ?? b.message}
													<span class="block text-xs text-[var(--color-text-muted)]"
														>{b.message}</span
													>
												</li>
											{/each}
										</ul>
									{/if}
									<ol class="flex flex-col gap-2">
										{#each removalSteps as s (s.step)}
											<li class="flex flex-col gap-0.5" data-testid="onboarding-removal-step">
												<span class="flex items-center justify-between gap-3 text-sm">
													<span>{s.label}</span>
													<Pill tone={s.tone}>{s.statusLabel}</Pill>
												</span>
												{#if s.summary}
													<span class="break-words text-xs text-[var(--color-text-muted)]"
														>{s.summary}</span
													>
												{/if}
												{#if s.error}
													<details class="text-xs text-[var(--color-text-muted)]">
														<summary class="cursor-pointer">Technical details</summary>
														<code class="mt-1 block whitespace-pre-wrap break-words">{s.error}</code
														>
													</details>
												{/if}
											</li>
										{/each}
									</ol>
									{#if removalProgressText(rm)}
										<p
											class="mt-2 text-xs text-[var(--color-text-muted)]"
											data-testid="onboarding-removal-progress"
											aria-live="polite"
										>
											{removalProgressText(rm)}
										</p>
									{/if}
									{#if removalStaleText(rm)}
										<p
											class="mt-2 text-xs text-[var(--color-danger)]"
											role="alert"
											data-testid="onboarding-removal-stale"
										>
											{removalStaleText(rm)}
										</p>
									{/if}
									{#if rm.state === 'failed'}
										<p class="mt-2 text-xs text-[var(--color-text)]">
											The automatic retries stopped after {rm.attempts} attempts. Retry, or close it by
											hand once you have finished the cleanup yourself.
										</p>
									{/if}
									{#if rm.resolved}
										<p
											class="mt-2 text-xs text-[var(--color-text-muted)]"
											data-testid="onboarding-removal-resolved"
										>
											{resolvedText(rm.resolved)}
										</p>
									{/if}
								</div>
								{#if legacyCorrectable}
									<div class="flex flex-col gap-2" data-testid="onboarding-removal-legacy-fix">
										<p class="text-xs text-[var(--color-text-muted)]">
											To correct the login, enter it again and Retry.
										</p>
										<Input
											name="legacy_user_id_fix"
											label="Login user id"
											bind:value={legacyUserId}
										/>
										<Input
											name="legacy_evidence_fix"
											label="How you know it is theirs"
											bind:value={legacyEvidence}
										/>
										<p
											class="text-xs text-[var(--color-text-muted)]"
											data-testid="onboarding-evidence-fingerprint-fix"
										>
											{EVIDENCE_FINGERPRINT_NOTE}
										</p>
									</div>
								{/if}
							{/if}

							{#if actionNotice}
								<p
									class="text-sm text-[var(--color-text)]"
									role="status"
									data-testid="onboarding-notice"
								>
									{actionNotice}
								</p>
							{/if}
							{#if actionError}
								<p
									class="text-sm text-[var(--color-danger)]"
									role="alert"
									data-testid="onboarding-action-error"
								>
									{actionError}
								</p>
							{/if}

							{#if canDecide(selected)}
								<Input
									name="workspace_name"
									label="Workspace name"
									bind:value={workspaceName}
									placeholder={selected.suggested_tenant_name}
								/>
								<div data-testid="onboarding-approve-llm-access">
									<LlmAccessSelect
										name="approve_llm_access"
										bind:value={approveLlmAccess}
										onchange={() => {
											approveLlmTouched = true;
										}}
									/>
								</div>
								<div class="flex justify-end gap-2">
									<Button
										variant="secondary"
										disabled={busy !== null || notConfigured}
										onclick={() => (confirmRejectOpen = true)}>Decline</Button
									>
									<Button
										variant="primary"
										loading={busy === 'approve'}
										disabled={busy !== null || notConfigured || workspaceName.trim().length < 2}
										onclick={approve}>Approve</Button
									>
								</div>
							{:else if canRetry(selected)}
								<div class="flex justify-end">
									<Button
										variant="primary"
										loading={busy === 'retry'}
										disabled={busy !== null || notConfigured}
										onclick={requestRetry}>Retry setup</Button
									>
								</div>
							{:else if canRetryRemoval(selected)}
								<div class="flex justify-end gap-2">
									{#if canResolveRemoval(selected)}
										<Button
											variant="secondary"
											loading={busy === 'resolve'}
											disabled={busy !== null || notConfigured}
											onclick={openResolve}>Close by hand</Button
										>
									{/if}
									<Button
										variant="primary"
										loading={busy === 'removal_retry'}
										disabled={busy !== null || notConfigured}
										onclick={retryRemoval}>Retry removal</Button
									>
								</div>
							{/if}
							{#if canRemove(selected)}
								<div
									class="flex flex-col gap-2 border-t border-[var(--color-border)] pt-4"
									data-testid="onboarding-remove"
								>
									<p class="text-xs text-[var(--color-text-muted)]">
										Removing deletes this person’s early-access workspace, revokes its licences,
										retires the login this request created and erases their personal data.
									</p>
									<div class="flex justify-end">
										<Button
											variant="danger"
											loading={busy === 'remove'}
											disabled={busy !== null || notConfigured}
											onclick={openRemove}>Remove early-access workspace</Button
										>
									</div>
								</div>
							{/if}
						{/if}
					</div>
				</Card>
			{/if}

			<!-- ── invite ── -->
			<Card class="p-5">
				<form
					class="flex flex-col gap-4"
					data-testid="onboarding-invite-form"
					onsubmit={(e) => {
						e.preventDefault();
						void invite();
					}}
				>
					<div>
						<h2 class="text-base font-semibold text-[var(--color-text)]">Invite to early access</h2>
						<p class="text-sm text-[var(--color-text-muted)]">
							Skips the queue: their workspace is created right away and they get a welcome email to
							set their password.
						</p>
					</div>
					{#if inviteError}
						<p class="text-sm text-[var(--color-danger)]" role="alert" data-testid="invite-error">
							{inviteError}
							{#if inviteExistingId}
								{@const existingId = inviteExistingId}
								<button
									type="button"
									class="underline"
									data-testid="invite-open-existing"
									onclick={() => openById(existingId)}>Open their request</button
								>
							{/if}
						</p>
					{/if}
					{#if inviteNotice}
						<p class="text-sm text-[var(--color-text)]" role="status" data-testid="invite-notice">
							{inviteNotice}
						</p>
					{/if}
					<Input
						name="invite_email"
						label="Email"
						type="email"
						placeholder="name@company.com"
						bind:value={inviteEmail}
						error={inviteEmail && !inviteEmailValid ? 'Enter a valid email address.' : undefined}
					/>
					<Input
						name="invite_name"
						label="Name"
						placeholder="Ada Lovelace"
						bind:value={inviteName}
					/>
					<Input
						name="invite_company"
						label="Company (optional)"
						placeholder="Acme Ltd"
						bind:value={inviteCompany}
					/>
					<Select
						name="invite_locale"
						label="Email language"
						value={inviteLocale}
						onchange={(e: Event) =>
							(inviteLocale = (e.target as HTMLSelectElement).value as SignupLocale)}
						options={localeOptions}
						placeholder=""
					/>
					<div data-testid="invite-llm-access">
						<LlmAccessSelect
							name="invite_llm_access"
							bind:value={inviteLlmAccess}
							onchange={() => {
								inviteLlmTouched = true;
							}}
						/>
					</div>
					<div class="flex justify-end">
						<Button type="submit" variant="primary" loading={inviting} disabled={!canInvite}>
							Send invitation
						</Button>
					</div>
				</form>
			</Card>
		</section>
	</div>
</Page>

<Dialog bind:open={confirmRejectOpen} title="Decline this request?">
	{#if selected}
		<div class="flex flex-col gap-4" data-testid="onboarding-reject-confirm">
			<p class="text-sm text-[var(--color-text)]">
				<strong>{selected.name || selected.email}</strong> will not get early access. This can't be undone
				from here — invite them later if you change your mind.
			</p>
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (confirmRejectOpen = false)}>Cancel</Button
				>
				<Button variant="danger" size="sm" onclick={confirmReject}>Decline</Button>
			</div>
		</div>
	{/if}
</Dialog>

<Dialog bind:open={confirmRetryOpen} title="Send a new welcome email?">
	{#if selected}
		<div class="flex flex-col gap-4" data-testid="onboarding-retry-confirm">
			<p class="text-sm text-[var(--color-text)]">{RETRY_UNCERTAIN_WARNING}</p>
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (confirmRetryOpen = false)}>Cancel</Button>
				<Button variant="primary" size="sm" onclick={retry}>Retry and send a new email</Button>
			</div>
		</div>
	{/if}
</Dialog>

<Dialog bind:open={confirmRemoveOpen} title="Remove this early-access workspace?">
	{#if selected}
		<form
			class="flex flex-col gap-4"
			data-testid="onboarding-remove-confirm"
			onsubmit={(e) => {
				e.preventDefault();
				void confirmRemove();
			}}
		>
			<p class="text-sm text-[var(--color-text)]">
				This removes <strong>{selected.name || selected.email}</strong>’s workspace
				<strong>{selected.tenant_slug}</strong> for good: it is suspended, its licences are revoked, its
				data is exported and then deleted, the login this request created is retired, and their name and
				email are erased.
			</p>
			<p class="text-sm text-[var(--color-text)]" data-testid="onboarding-remove-stop-note">
				{REMOVE_STOP_NOTE}
			</p>
			<Input
				name="remove_confirm_slug"
				label={`Type ${selected.tenant_slug} to confirm`}
				autocomplete="off"
				spellcheck={false}
				bind:value={removeSlug}
			/>
			{#if selected.needs_legacy_identity}
				<div class="flex flex-col gap-2" data-testid="onboarding-remove-legacy">
					<p class="text-xs text-[var(--color-text-muted)]">
						This request was approved before logins were tracked, so name the login it created. It
						is only retired if it matches this email address, was created during the approval and
						has no other roles.
					</p>
					<Input
						name="legacy_user_id"
						label="Login user id"
						placeholder="00000000-0000-0000-0000-000000000000"
						bind:value={legacyUserId}
						error={legacyUserId && !isUuid(legacyUserId) ? 'Enter the login’s user id.' : undefined}
					/>
					<Input
						name="legacy_evidence"
						label="How you know it is theirs"
						placeholder="e.g. the provisioning log line"
						bind:value={legacyEvidence}
					/>
					<p
						class="text-xs text-[var(--color-text-muted)]"
						data-testid="onboarding-evidence-fingerprint"
					>
						{EVIDENCE_FINGERPRINT_NOTE}
					</p>
					<label class="flex items-start gap-2 text-sm text-[var(--color-text)]">
						<input
							type="checkbox"
							class="mt-0.5"
							name="allow_credentialed_delete"
							checked={allowCredentialedDelete}
							onchange={(e) => (allowCredentialedDelete = e.currentTarget.checked)}
						/>
						<span>Delete the login even if a password was set (otherwise it is switched off).</span>
					</label>
				</div>
			{/if}
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (confirmRemoveOpen = false)}>Cancel</Button
				>
				<Button type="submit" variant="danger" size="sm" disabled={!removeReady}
					>Remove workspace</Button
				>
			</div>
		</form>
	{/if}
</Dialog>

<Dialog bind:open={confirmResolveOpen} title="Close this removal by hand?">
	{#if selected}
		<form
			class="flex flex-col gap-4"
			data-testid="onboarding-resolve-confirm"
			onsubmit={(e) => {
				e.preventDefault();
				void confirmResolve();
			}}
		>
			<p class="text-sm text-[var(--color-text)]">
				Closing marks the removal as finished without running the remaining steps. Whatever they
				would have done — deleting the workspace, revoking licences, retiring the login — is up to
				you. The email address can sign up again afterwards.
			</p>
			<p class="text-sm text-[var(--color-text)]" data-testid="onboarding-resolve-erase-warning">
				{RESOLVE_ERASE_WARNING}
			</p>
			<Input name="resolve_note" label="What you did" bind:value={resolveNote} />
			<label class="flex items-start gap-2 text-sm text-[var(--color-text)]">
				<input
					type="checkbox"
					class="mt-0.5"
					name="acknowledge_live_access"
					checked={resolveAck}
					onchange={(e) => (resolveAck = e.currentTarget.checked)}
				/>
				<span>I understand the workspace, its licences or the login may still work.</span>
			</label>
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (confirmResolveOpen = false)}
					>Cancel</Button
				>
				<Button
					type="submit"
					variant="danger"
					size="sm"
					disabled={!resolveAck || resolveNote.trim().length < 3}>Close the removal</Button
				>
			</div>
		</form>
	{/if}
</Dialog>
