<script lang="ts">
	// One provider slot on the Providers page (P3 WP5).
	//
	// The API key is WRITE-ONLY. This component never receives it from the server
	// (only `has_secret` + `key_fingerprint`), never pre-fills the field, and drops
	// whatever the user typed as soon as a save succeeds. Secret intent maps onto
	// the PUT/test body as: keep → the `secret` key is OMITTED (never `null`),
	// clear → `""`, replace → the typed value.
	//
	// The parent re-mounts this card (keyed on slot + version + source) whenever the
	// server state changes, so the form always starts from the stored connection.
	//
	// P8: every label, field, required rule and secret label comes from the server's
	// requirements manifest (`requirement`, GET /api/provider-requirements) — there is
	// no per-kind field table in the frontend.
	import { onDestroy, tick } from 'svelte';
	import {
		providerError,
		providers,
		type ConnectionDraft,
		type ConnectionTestResult,
		type LlmAccessMode,
		type ProviderSlot,
		type SlotView
	} from '$lib/api/providers.js';
	import type { SlotRequirement } from '$lib/api/provider-requirements.js';
	import { providerSlotAnchor } from '$lib/api/byo-provider.js';
	import { Badge, Button, Card, Dialog, Input, Select } from '$lib/components/ui';
	import {
		buildDraft,
		fieldPlaceholder,
		hasModelField,
		initialValues,
		modelListDraft,
		normalizeModels,
		kindLabel,
		kindRequirement,
		validateDraft,
		type FieldValues,
		type SecretState
	} from './connection-form.js';
	import { formatDateTime } from '$lib/utils/format';
	import { toastSuccess } from '$lib/stores/toast.svelte.js';
	import { EXAMPLE_ENDPOINTS, PROBE_CAVEAT } from './provider-groups.js';
	import {
		LOCKED_SLOT_REASON,
		slotLockedByAccess,
		slotRequiredByAccess,
		usedByText
	} from './llm-access.js';
	import { platformGatewayUrl, slotApiShape } from './slot-api-shapes.js';

	let {
		slot,
		requirement,
		missing = false,
		notice = null,
		canWrite: canWriteProp = true,
		stateKnown = true,
		access = null,
		onchanged,
		onreload
	}: {
		slot: ProviderSlot;
		/** The manifest entry for this slot; absent for platform-only slots. */
		requirement?: SlotRequirement;
		/** Named by a refused run start (`/providers?missing=…`): highlighted until registered. */
		missing?: boolean;
		/** Message the page carries across a re-mount (e.g. after VERSION_CONFLICT). */
		notice?: string | null;
		/** False for a caller without tenant_admin: every control is disabled (read-only). */
		canWrite?: boolean;
		/** False when the tenant's state could not be read (non-admin): no source is claimed. */
		stateKnown?: boolean;
		/** The tenant's LLM-access mode (`llm_access.mode`); null = unknown, nothing locked. */
		access?: LlmAccessMode | null;
		/** Server state changed (saved / removed): the parent swaps in the new view or reloads. */
		onchanged: (next: SlotView | null) => void | Promise<void>;
		/** Reload everything and show `message` on this slot afterwards. */
		onreload: (message: string) => void | Promise<void>;
	} = $props();

	// Initial values only — the card is re-mounted when the server state changes.
	// svelte-ignore state_referenced_locally
	const initial = slot;
	const conn = initial.connection ?? null;
	// svelte-ignore state_referenced_locally
	const req = requirement;
	const label = req?.label || initial.slot;
	const kindName = (k: string): string => kindLabel(req, k);
	const fieldId = (f: string): string =>
		`provider-${initial.slot.replace(/[^a-z0-9]+/gi, '-')}-${f}`;
	const secretFieldId = fieldId('secret');
	const modelListId = fieldId('model-options');

	/** `platform_only`: the server refuses own registrations here (409) — the form is read-only. */
	const locked = $derived(slotLockedByAccess(access, slot.slot));
	const canWrite = $derived(canWriteProp && !locked);
	/** `byo_required`: this model service has no registration yet and runs need one. */
	const requiredByAccess = $derived(stateKnown && slotRequiredByAccess(access, slot));
	const usedBy = usedByText(initial.slot);
	const gatewayUrl = platformGatewayUrl(initial.slot);

	/** Model ids from "Load models"; the model input keeps accepting free text. */
	let modelOptions = $state<string[]>([]);
	let loadingModels = $state(false);
	let modelsError = $state<string | null>(null);
	let modelsLoadedFor = $state<string | null>(null);

	let kind = $state(conn?.kind ?? initial.allowed_kinds[0] ?? '');
	/** The wire shape a provider for this GPU / model slot must expose (static map),
	 *  per chosen kind where the kinds differ (OCR). */
	const apiShape = $derived(slotApiShape(initial.slot, kind));
	/** base_url / model / options.* — which ones show depends on the kind (manifest). */
	let values = $state<FieldValues>(initialValues(req, conn));
	/** keep = omit `secret` (no stored key → no key); replace = send `secretValue`; clear = send "". */
	let secretMode = $state<'keep' | 'replace' | 'clear'>(conn?.has_secret ? 'keep' : 'replace');
	let secretValue = $state('');

	let testing = $state(false);
	let saving = $state(false);
	let removing = $state(false);
	let testResult = $state<ConnectionTestResult | null>(null);
	let error = $state<string | null>(null);
	let removeOpen = $state(false);
	/** PROVIDER_TEST_RATE_LIMITED: Test + Save stay disabled until the server's retry window ends. */
	let rateLimited = $state(false);
	let rateLimitTimer: ReturnType<typeof setTimeout> | null = null;

	function startCooldown(seconds: number): void {
		if (rateLimitTimer) clearTimeout(rateLimitTimer);
		rateLimited = true;
		rateLimitTimer = setTimeout(() => {
			rateLimited = false;
			rateLimitTimer = null;
		}, seconds * 1000);
	}
	onDestroy(() => {
		if (rateLimitTimer) clearTimeout(rateLimitTimer);
	});

	const kindOptions = $derived(slot.allowed_kinds.map((k) => ({ value: k, label: kindName(k) })));
	const busy = $derived(testing || saving || removing || loadingModels);
	/** The manifest's form for the chosen kind; `undefined` = the server describes none. */
	const spec = $derived(kindRequirement(req, kind));
	/** Owner-testing hint for a kind that needs its own endpoint (self-hosted / protocol). */
	const exampleEndpoint = $derived(
		spec?.fields.some((f) => f.key === 'base_url' && f.required)
			? (EXAMPLE_ENDPOINTS[initial.slot] ?? null)
			: null
	);
	/** Kind switched away from the stored connection's kind and the new kind needs a key:
	 *  the stored key belongs to the old provider and is never carried over. */
	const needsNewKey = $derived(!!conn && kind !== conn.kind && !!spec?.secret_required);
	const secretState = $derived<SecretState>({
		mode: needsNewKey ? 'replace' : secretMode,
		value: secretValue,
		hasStored: conn?.has_secret ?? false,
		requireNewFor: needsNewKey ? kindName(kind) : undefined
	});
	/** Client-side checks run once the user first tries Test/Save, then live. */
	let attempted = $state(false);
	const fieldErrors = $derived<Record<string, string>>(
		attempted && spec ? validateDraft(spec, values, secretState) : {}
	);

	function testResultText(r: ConnectionTestResult): string {
		if (r.ok) return `Test passed: ${r.message}`;
		const status = r.upstream_status != null ? ` (HTTP ${r.upstream_status})` : '';
		return `Test failed${status}: ${r.message}`;
	}

	function lastTestText(c: NonNullable<SlotView['connection']>): string {
		const when = formatDateTime(c.last_test_at ?? null) || '—';
		if (c.last_test_ok) return `Last test ${when}: passed`;
		return `Last test ${when}: failed${c.last_test_error ? ` — ${c.last_test_error}` : ''}`;
	}

	/** Secret: keep → OMITTED, clear → "", replace → typed. Stored options not shown are carried. */
	function draft(): ConnectionDraft | null {
		return spec ? buildDraft(kind, spec, values, conn?.options, secretState) : null;
	}

	/** False (and the inline field errors appear) when the draft fails the client-side checks. */
	async function checkFields(): Promise<boolean> {
		attempted = true;
		if (!spec) return false;
		const errors = validateDraft(spec, values, secretState);
		if (Object.keys(errors).length === 0) return true;
		const first = spec.fields.find((f) => errors[f.key]);
		await tick();
		if (first) document.getElementById(fieldId(first.key))?.focus();
		else if (errors.secret && secretState.mode === 'replace')
			document.getElementById(secretFieldId)?.focus();
		return false;
	}

	async function focusSecret(): Promise<void> {
		secretMode = 'replace';
		await tick();
		document.getElementById(secretFieldId)?.focus();
	}

	async function handle(err: unknown, fallback: string): Promise<void> {
		const info = providerError(err, fallback);
		if (info.action === 'reload') {
			await onreload(info.message);
			return;
		}
		error = info.message;
		if (info.retryAfterSeconds !== null && info.retryAfterSeconds > 0) {
			startCooldown(info.retryAfterSeconds);
		}
		if (info.action === 'focus-secret') await focusSecret();
	}

	async function runTest(): Promise<void> {
		if (busy || rateLimited || !canWrite) return;
		if (!(await checkFields())) return;
		testing = true;
		error = null;
		testResult = null;
		try {
			const body = draft();
			if (!body) return;
			testResult = await providers.test(slot.slot, body);
		} catch (e) {
			await handle(e, 'Could not run the test.');
		} finally {
			testing = false;
		}
	}

	async function save(): Promise<void> {
		if (busy || rateLimited || !kind || !canWrite) return;
		if (!(await checkFields())) return;
		saving = true;
		error = null;
		testResult = null;
		try {
			const body = draft();
			if (!body) return;
			const next = await providers.save(slot.slot, {
				...body,
				expected_version: conn?.version ?? 0
			});
			secretValue = '';
			toastSuccess(`${label} saved`, 'The connection passed a live test and is now in use.');
			await onchanged(next);
		} catch (e) {
			await handle(e, 'Could not save the connection.');
		} finally {
			saving = false;
		}
	}

	async function loadModels(): Promise<void> {
		if (busy || !canWrite || !spec) return;
		loadingModels = true;
		modelsError = null;
		try {
			const res = await providers.models(
				slot.slot,
				modelListDraft(kind, spec, values, secretState)
			);
			modelOptions = normalizeModels(res?.models);
			modelsLoadedFor = kind;
			if (modelOptions.length === 0) modelsError = 'The provider returned no models.';
		} catch (e) {
			modelOptions = [];
			modelsLoadedFor = null;
			const info = providerError(e, "Couldn't load the provider's models.");
			modelsError = info.message;
			// SECRET_REENTRY_REQUIRED: kind/base URL changed, the stored key can't be reused.
			if (info.action === 'focus-secret') await focusSecret();
		} finally {
			loadingModels = false;
		}
	}
	/** A list loaded for another kind does not apply to the one now chosen. */
	const shownModels = $derived(modelsLoadedFor === kind ? modelOptions : []);

	async function confirmRemove(): Promise<void> {
		removeOpen = false;
		// Removing stays allowed under Local only: it returns the slot to the platform model.
		if (!canWriteProp) return;
		removing = true;
		error = null;
		try {
			await providers.remove(slot.slot);
			toastSuccess(`${label} reset`, 'New runs use the platform default again.');
			await onchanged(null);
		} catch (e) {
			await handle(e, 'Could not remove the connection.');
		} finally {
			removing = false;
		}
	}
</script>

<div
	id={providerSlotAnchor(slot.slot)}
	data-testid="provider-card-{slot.slot}"
	data-missing={missing ? 'true' : undefined}
	class={missing ? 'rounded-[var(--radius-lg)] ring-2 ring-status-pending' : undefined}
>
	<Card class="p-5">
		<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
			<div>
				<h2 class="text-sm font-semibold text-text">{label}</h2>
				{#if missing}
					<p class="mt-1" data-testid="provider-missing-{slot.slot}">
						<Badge variant="warning">Needed to start your run</Badge>
					</p>
				{/if}
				<p class="mt-1 text-xs text-text-muted">
					{#if req}Platform default: {kindName(slot.default_kind)}{:else}Provided by the platform{/if}{#if slot.byo_required}
						· your own connection is required on this deployment{/if}
				</p>
				{#if usedBy}
					<p class="mt-1 text-xs text-text" data-testid="provider-used-by-{slot.slot}">
						<span class="font-medium">Used by:</span>
						{usedBy}
					</p>
				{/if}
				{#if stateKnown && slot.source === 'tenant'}
					<p class="mt-1 text-xs text-text-muted" data-testid="provider-own-note-{slot.slot}">
						Your connection is used for this workspace's Studio runs.
					</p>
				{/if}
			</div>
			{#if stateKnown}
				<span data-testid="provider-source-{slot.slot}">
					{#if slot.source === 'tenant'}
						<Badge variant="info">Your connection</Badge>
					{:else if requiredByAccess}
						<Badge variant="warning">Required — not registered</Badge>
					{:else if slot.byo_required}
						<Badge variant="warning">Not configured</Badge>
					{:else}
						<Badge>Platform default</Badge>
					{/if}
				</span>
			{/if}
		</div>

		{#if apiShape}
			<details
				class="mb-4 min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-xs"
				data-testid="provider-api-shape-{slot.slot}"
			>
				<summary class="cursor-pointer font-medium text-text">
					Expected API: <code class="break-all">{apiShape.endpoint}</code>
				</summary>
				<dl class="mt-2 grid grid-cols-1 gap-1 text-text-muted sm:grid-cols-[auto_1fr] sm:gap-x-3">
					<dt class="font-medium text-text">Request</dt>
					<dd class="min-w-0 break-words">{apiShape.request}</dd>
					<dt class="font-medium text-text">Response</dt>
					<dd class="min-w-0 break-words">{apiShape.response}</dd>
				</dl>
				{#if gatewayUrl}
					<p class="mt-2 break-words text-text-muted" data-testid="provider-gateway-{slot.slot}">
						Or point at the platform gateway <code class="break-all">{gatewayUrl}</code> with your licence
						token as the key.
					</p>
				{/if}
			</details>
		{/if}

		{#if requiredByAccess}
			<p
				class="mb-4 text-sm text-[var(--color-text)]"
				role="note"
				data-testid="provider-required-{slot.slot}"
			>
				<span class="font-semibold">Required — not registered.</span> This workspace must use its own
				providers: register one for this service, or runs that use it will not start.
			</p>
		{/if}
		{#if locked && slot.writable}
			<p class="mb-4 text-sm text-text-muted" role="note" data-testid="provider-locked-{slot.slot}">
				{LOCKED_SLOT_REASON}
			</p>
		{/if}

		{#if !slot.writable}
			<p class="text-sm text-text-muted" data-testid="provider-readonly">
				Platform provided — this provider can't be changed per workspace yet.
			</p>
		{:else if kindOptions.length === 0}
			<p class="text-sm text-text-muted" data-testid="provider-no-kinds">
				No provider types are enabled for this deployment, so the platform default is used.
			</p>
		{:else}
			<form
				class="flex flex-col gap-4"
				onsubmit={(e) => {
					e.preventDefault();
					void save();
				}}
			>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<Select
						name={fieldId('kind')}
						label="Provider type"
						value={kind}
						options={kindOptions}
						disabled={!canWrite}
						onchange={(e) => (kind = (e.currentTarget as HTMLSelectElement).value)}
					/>
					{#each spec?.fields ?? [] as f (f.key)}
						{#if f.key === 'model' && hasModelField(spec)}
							<div class="flex min-w-0 flex-col gap-1.5" data-testid="provider-model">
								<Input
									name={fieldId(f.key)}
									label={f.label}
									placeholder={spec ? fieldPlaceholder(f, spec) : ''}
									error={fieldErrors[f.key]}
									disabled={!canWrite}
									list={shownModels.length > 0 ? modelListId : undefined}
									bind:value={values[f.key]}
								/>
								{#if shownModels.length > 0}
									<datalist id={modelListId} data-testid="provider-model-options">
										{#each shownModels as m (m)}
											<option value={m}></option>
										{/each}
									</datalist>
									<p class="text-xs text-text-muted" data-testid="provider-models-loaded">
										{shownModels.length}
										{shownModels.length === 1 ? 'model' : 'models'} available — pick one or type any model
										id.
									</p>
								{/if}
								{#if modelsError}
									<p
										class="text-xs break-words text-[var(--color-danger)]"
										data-testid="provider-models-error"
									>
										{modelsError}
									</p>
								{/if}
								<div>
									<Button
										variant="ghost"
										size="sm"
										loading={loadingModels}
										disabled={busy || !canWrite}
										onclick={loadModels}
									>
										Load models
									</Button>
								</div>
							</div>
						{:else}
							<Input
								name={fieldId(f.key)}
								label={f.label}
								placeholder={spec ? fieldPlaceholder(f, spec) : ''}
								error={fieldErrors[f.key]}
								disabled={!canWrite}
								bind:value={values[f.key]}
								class={f.key === 'base_url' ? 'sm:col-span-2' : ''}
							/>
						{/if}
					{/each}
				</div>
				{#if spec?.help}
					<p class="-mt-2 text-xs text-text-muted" data-testid="provider-kind-help">{spec.help}</p>
				{/if}
				{#if exampleEndpoint}
					<p
						class="-mt-2 text-xs break-all text-text-muted"
						data-testid="provider-example-endpoint"
					>
						Example endpoint: <code>{exampleEndpoint}</code>
					</p>
				{/if}

				{#if !spec}
					<p class="text-sm text-text-muted" data-testid="provider-no-form">
						This provider type has no configuration form on this deployment.
					</p>
				{:else}
					<div data-testid="provider-secret">
						{#if conn?.has_secret && secretState.mode !== 'replace'}
							<p class="text-sm font-medium text-[var(--color-text-muted)]">{spec.secret_label}</p>
							<div class="mt-1.5 flex flex-wrap items-center gap-2">
								{#if secretMode === 'clear'}
									<span
										class="text-sm text-[var(--color-danger)]"
										data-testid="provider-secret-cleared"
									>
										The stored key will be removed when you save.
									</span>
									<Button
										variant="ghost"
										size="sm"
										disabled={!canWrite}
										onclick={() => (secretMode = 'keep')}
									>
										Undo
									</Button>
								{:else}
									<code
										class="rounded border border-[var(--color-border)] px-2 py-1 text-xs"
										data-testid="provider-secret-stored"
									>
										Stored key · {conn.key_fingerprint ?? '—'}
									</code>
									<Button variant="secondary" size="sm" disabled={!canWrite} onclick={focusSecret}>
										Replace
									</Button>
									<Button
										variant="ghost"
										size="sm"
										disabled={!canWrite}
										onclick={() => (secretMode = 'clear')}
									>
										Clear
									</Button>
								{/if}
							</div>
							{#if fieldErrors.secret}
								<p
									class="mt-1 text-sm text-[var(--color-danger)]"
									data-testid="{secretFieldId}-error"
								>
									{fieldErrors.secret}
								</p>
							{/if}
						{:else}
							<Input
								name={secretFieldId}
								label={spec.secret_label}
								error={fieldErrors.secret}
								type="password"
								disabled={!canWrite}
								autocomplete="off"
								spellcheck={false}
								placeholder={needsNewKey
									? `Enter a key for ${kindName(kind)}`
									: conn?.has_secret
										? 'Stored; leave blank to keep it'
										: spec.secret_required
											? 'Required'
											: 'Not set'}
								bind:value={secretValue}
							/>
							{#if conn?.has_secret && !needsNewKey}
								<div class="mt-1">
									<Button
										variant="ghost"
										size="sm"
										onclick={() => {
											secretValue = '';
											secretMode = 'keep';
										}}
									>
										Keep the stored key
									</Button>
								</div>
							{/if}
						{/if}
					</div>
				{/if}

				{#if notice}
					<p class="text-sm text-[var(--color-text)]" data-testid="provider-notice">{notice}</p>
				{/if}
				{#if error}
					<p class="text-sm text-[var(--color-danger)]" role="alert" data-testid="provider-error">
						{error}
					</p>
				{/if}
				{#if testResult}
					<p
						class="text-sm {testResult.ok ? 'text-status-completed' : 'text-[var(--color-danger)]'}"
						data-testid="provider-test-result"
					>
						{testResultText(testResult)}
					</p>
				{/if}

				{#if conn?.last_test_at}
					<p class="text-xs text-text-muted" data-testid="provider-last-test">
						{lastTestText(conn)}
					</p>
				{/if}

				<p class="text-xs text-text-muted" data-testid="provider-probe-caveat">{PROBE_CAVEAT}</p>

				<div class="flex flex-wrap justify-end gap-2">
					{#if slot.source === 'tenant'}
						<Button
							variant="ghost"
							size="sm"
							loading={removing}
							disabled={busy || !canWriteProp}
							onclick={() => (removeOpen = true)}
						>
							Remove
						</Button>
					{/if}
					<Button
						variant="secondary"
						size="sm"
						loading={testing}
						disabled={busy || rateLimited || !spec || !canWrite}
						onclick={runTest}
					>
						Test
					</Button>
					<Button
						type="submit"
						variant="primary"
						size="sm"
						loading={saving}
						disabled={busy || rateLimited || !kind || !spec || !canWrite}
					>
						{saving ? 'Testing and saving…' : 'Save'}
					</Button>
				</div>
			</form>
		{/if}
	</Card>
</div>

<Dialog bind:open={removeOpen} title="Use the platform default?">
	{#if removeOpen}
		<div class="flex flex-col gap-4" data-testid="provider-remove-confirm">
			<p class="text-sm text-[var(--color-text)]">
				Your {label} connection and its stored key are removed. New runs use the platform default; runs
				already in progress keep the connection they started with.
			</p>
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (removeOpen = false)}>Cancel</Button>
				<Button variant="danger" size="sm" onclick={confirmRemove}>Remove</Button>
			</div>
		</div>
	{/if}
</Dialog>
