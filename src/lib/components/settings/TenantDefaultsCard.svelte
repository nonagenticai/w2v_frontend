<script lang="ts">
	// Workspace production defaults (P6 FE-1), server-backed: GET /api/tenant/defaults
	// (any member — read-only here), PUT (tenant_admin — the server 403s on its own).
	// Every control has a "Deployment default" choice that stores null; the label
	// names what the deployment actually uses. A save never changes a run that
	// already exists (runs pin the defaults at creation).
	//
	// Voice: only voices the API accepts. Without a tenant TTS connection that is the
	// kokoro catalog; with one, the tenant provider's voice namespace cannot be
	// enumerated, so a free-text id is offered too. A 422 UNKNOWN_VOICE is shown
	// verbatim under the voice field.
	import { onMount } from 'svelte';
	import {
		tenantDefaults,
		formFromDefaults,
		bodyFromForm,
		validateDefaultsForm,
		tenantDefaultsError,
		RETENTION_MODES,
		TIMING_DIRECTOR_TIERS,
		CAPTIONS_MODES,
		type TenantDefaultsWire,
		type TenantDefaultsForm
	} from '$lib/api/tenant-defaults.js';
	import { providers } from '$lib/api/providers.js';
	import { tts } from '$lib/api/tts.js';
	import { byoProviderRequiredFromError, type ByoProviderRequired } from '$lib/api/byo-provider.js';
	import ByoProviderRequiredNotice from '$lib/components/providers/ByoProviderRequiredNotice.svelte';
	import { isTenantAdmin } from '$lib/stores/auth.svelte';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte.js';
	import { KOKORO_VOICE_GROUPS, VOICE_CATALOG, voiceLabel } from '$lib/studio/kokoro-voices';
	import { CAPTIONS_MODE_LABELS } from '$lib/types';
	import { Card, Button, Input, Select, Spinner, ErrorState, Skeleton } from '$lib/components/ui';
	import { Volume2 } from '@lucide/svelte';

	const canEdit = isTenantAdmin();

	let view = $state<TenantDefaultsWire | null>(null);
	let form = $state<TenantDefaultsForm | null>(null);
	let loadError = $state<unknown>(null);
	let loading = $state(true);
	let saving = $state(false);
	let formError = $state('');
	let fieldErrors = $state<Record<string, string>>({});
	/** True when the tenant has its own active TTS connection (admin-only lookup). */
	let tenantTts = $state(false);
	/** The voice is typed as a provider id instead of picked from the kokoro catalog. */
	let customMode = $state(false);

	function adopt(v: TenantDefaultsWire): void {
		view = v;
		form = formFromDefaults(v);
		customMode = form.voiceId !== '' && !VOICE_CATALOG.has(form.voiceId);
	}

	async function load(): Promise<void> {
		loading = true;
		loadError = null;
		try {
			adopt(await tenantDefaults.get());
		} catch (e) {
			loadError = e;
		} finally {
			loading = false;
		}
	}

	async function loadTtsSlot(): Promise<void> {
		// /api/tenant/connections is tenant_admin-only; a member never edits, so it
		// never needs to know. A failure keeps the conservative catalog-only picker.
		try {
			const slots = (await providers.list()).items;
			tenantTts = slots.some((s) => s.slot === 'tts' && s.source === 'tenant' && !!s.connection);
		} catch {
			tenantTts = false;
		}
	}

	onMount(() => {
		void load();
		if (canEdit) void loadTtsSlot();
	});

	async function save(): Promise<void> {
		if (!form || !view) return;
		formError = '';
		fieldErrors = validateDefaultsForm(form);
		if (Object.keys(fieldErrors).length) return;
		saving = true;
		try {
			adopt(await tenantDefaults.put(bodyFromForm(form, view.version)));
			toastSuccess('Defaults saved', 'New runs use them; runs that already exist are unchanged.');
		} catch (e) {
			const info = tenantDefaultsError(e);
			if (info.field) fieldErrors = { [info.field]: info.message };
			else formError = info.message;
			if (info.action === 'reload') await load();
		} finally {
			saving = false;
		}
	}

	// --- Voice preview (kokoro catalog voices only) ---
	let previewing = $state(false);
	// A 402 `byo_provider_required` replaces the generic "Voice preview failed"
	// toast with the inline what-to-do notice (w2v_orchestrator#1106).
	let previewByo = $state<ByoProviderRequired | null>(null);
	async function preview(): Promise<void> {
		if (!form || previewing || !VOICE_CATALOG.has(form.voiceId)) return;
		previewByo = null;
		previewing = true;
		try {
			const blob = await tts.previewVoice({
				provider: 'kokoro',
				voice: form.voiceId,
				speed: Number(form.speed) || 1.0
			});
			const url = URL.createObjectURL(blob);
			const audio = new Audio(url);
			audio.onended = () => URL.revokeObjectURL(url);
			await audio.play();
		} catch (e) {
			previewByo = byoProviderRequiredFromError(e);
			if (!previewByo)
				toastError('Voice preview failed', e instanceof Error ? e.message : undefined);
		} finally {
			previewing = false;
		}
	}

	// Selects write through `onchange` (reading the DOM value) rather than
	// `bind:value` on a nested form field — same pattern as the usage page.
	type SelectKey = 'captionsMode' | 'karaoke' | 'retentionMode' | 'timingDirector';
	function pick(key: SelectKey, e: Event): void {
		if (!form) return;
		const value = (e.currentTarget as HTMLSelectElement).value;
		form = { ...form, [key]: value } as TenantDefaultsForm;
	}

	const dep = $derived(view?.deployment);
	const onOff = (b: boolean | undefined): string => (b ? 'on' : 'off');

	const captionsOptions = $derived([
		{
			value: '',
			label: `Deployment default (${dep ? CAPTIONS_MODE_LABELS[dep.captions_mode] : '…'})`
		},
		...CAPTIONS_MODES.map((m) => ({ value: m, label: CAPTIONS_MODE_LABELS[m] }))
	]);
	const karaokeOptions = $derived([
		{ value: '', label: `Deployment default (${onOff(dep?.captions_karaoke)})` },
		{ value: 'on', label: 'On — word-by-word highlight' },
		{ value: 'off', label: 'Off' }
	]);
	const RETENTION_LABELS: Record<string, string> = {
		auto: 'Auto — plan and apply retention edits',
		critique_only: 'Critique only — suggest, never apply',
		off: 'Off'
	};
	const retentionOptions = $derived([
		{
			value: '',
			label: `Deployment default (${dep?.retention_mode ? RETENTION_LABELS[dep.retention_mode] : 'off'})`
		},
		...RETENTION_MODES.map((m) => ({ value: m, label: RETENTION_LABELS[m] }))
	]);
	const tierOptions = $derived([
		{
			value: '',
			label: `Deployment default (${dep?.timing_director_model_tier ?? 'router default'})`
		},
		...TIMING_DIRECTOR_TIERS.map((t) => ({ value: t, label: t }))
	]);

	const selectClasses =
		'w-full rounded-lg border px-3 py-2 text-sm bg-input-bg text-text focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background border-border hover:border-border-hover focus:border-border-focus focus:ring-border-focus/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed';
</script>

<div data-testid="tenant-defaults">
	<Card class="p-5">
		<div class="mb-4 flex flex-wrap items-baseline justify-between gap-2">
			<h2 class="text-sm font-semibold text-text">Workspace defaults</h2>
			{#if view && view.version > 0 && view.updated_at}
				<span class="text-xs text-text-muted" data-testid="tenant-defaults-version">
					Version {view.version} · updated {new Date(view.updated_at).toLocaleString()}
				</span>
			{/if}
		</div>
		<p class="mb-4 text-xs text-text-muted">
			What every new project and run in this workspace starts from. A project's own settings still
			win, and a run keeps the defaults it started with.
		</p>

		{#if loading && !view}
			<Skeleton height="8rem" />
		{:else if loadError && !view}
			<ErrorState
				title="Couldn't load the defaults"
				error={loadError}
				onRetry={() => void load()}
			/>
		{:else if form && view}
			{#if !canEdit}
				<p class="mb-4 text-xs text-text-muted" data-testid="tenant-defaults-readonly">
					Read-only — only a workspace admin can change these.
				</p>
			{/if}
			<fieldset disabled={!canEdit || saving} class="space-y-6">
				<!-- Voice -->
				<div>
					<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
						Narration voice
					</h3>
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
						<div class="flex flex-col gap-1.5 sm:col-span-2">
							<label for="defaults-voice" class="text-sm font-medium text-text-secondary">
								Voice
							</label>
							<select
								id="defaults-voice"
								name="defaults-voice"
								class={selectClasses}
								value={customMode ? '__custom__' : form.voiceId}
								onchange={(e) => {
									const v = (e.currentTarget as HTMLSelectElement).value;
									if (!form) return;
									customMode = v === '__custom__';
									form.voiceId = customMode ? '' : v;
								}}
							>
								<option value="">Deployment default (narrator's own voice)</option>
								{#each KOKORO_VOICE_GROUPS as group (group.language)}
									<optgroup label={group.language}>
										{#each group.voices as v (v.value)}
											<option value={v.value}>{v.label} — {v.value}</option>
										{/each}
									</optgroup>
								{/each}
								{#if tenantTts || customMode}
									<option value="__custom__">Your TTS provider's voice id…</option>
								{/if}
							</select>
							{#if customMode}
								<Input
									name="defaults-voice-custom"
									label="Provider voice id"
									bind:value={form.voiceId}
									placeholder="e.g. an ElevenLabs voice_id"
								/>
								<p class="text-xs text-text-muted">
									{tenantTts
										? 'Your workspace has its own TTS provider, so any voice id it knows is accepted.'
										: 'This id is not a catalog voice and no workspace TTS provider was found; narration would fall back to the catalog voices and reject it.'}
								</p>
							{/if}
							{#if fieldErrors.voiceId}
								<p class="text-xs text-status-failed" data-testid="defaults-voice-error">
									{fieldErrors.voiceId}
								</p>
							{/if}
						</div>
						<div class="flex flex-col gap-1.5">
							<Input
								name="defaults-speed"
								label="Speed (0.5 – 2.0)"
								type="number"
								min="0.5"
								max="2"
								step="0.05"
								bind:value={form.speed}
								placeholder="Deployment default"
								error={fieldErrors.speed}
							/>
						</div>
					</div>
					{#if form.voiceId && VOICE_CATALOG.has(form.voiceId)}
						<div class="mt-2">
							<Button variant="secondary" size="sm" onclick={preview} disabled={previewing}>
								{#if previewing}
									<span class="mr-1.5 inline-block"><Spinner size="sm" /></span>
								{:else}
									<Volume2 class="h-4 w-4" />
								{/if}
								Preview {voiceLabel(form.voiceId)}
							</Button>
							{#if previewByo}
								<div class="mt-2"><ByoProviderRequiredNotice required={previewByo} compact /></div>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Brand kit -->
				<div>
					<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
						Brand kit
					</h3>
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
						{#each [{ key: 'primaryColor', label: 'Primary color' }, { key: 'secondaryColor', label: 'Secondary color' }] as const as c (c.key)}
							<div class="flex items-end gap-2">
								<div class="flex-1">
									<Input
										name={`defaults-${c.key}`}
										label={c.label}
										bind:value={form[c.key]}
										placeholder="#4F46E5 — blank = none"
										error={fieldErrors[c.key]}
									/>
								</div>
								<span
									class="mb-1 inline-block h-8 w-8 rounded border border-border"
									style:background={form[c.key] || 'transparent'}
									aria-hidden="true"
								></span>
							</div>
						{/each}
						<Input
							name="defaults-font"
							label="Font family"
							bind:value={form.fontFamily}
							placeholder="e.g. Inter — blank = none"
							error={fieldErrors.fontFamily}
						/>
					</div>
					<p class="mt-1 text-xs text-text-muted">
						A brief's brand, or the palette read from a reference site, still wins over these.
					</p>
				</div>

				<!-- Captions -->
				<div>
					<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
						Captions
					</h3>
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<Select
							name="defaults-captions-mode"
							label="Captions on new deliverables"
							value={form.captionsMode}
							onchange={(e) => pick('captionsMode', e)}
							options={captionsOptions}
							placeholder=""
						/>
						<Select
							name="defaults-karaoke"
							label="Karaoke highlight"
							value={form.karaoke}
							onchange={(e) => pick('karaoke', e)}
							options={karaokeOptions}
							placeholder=""
						/>
					</div>
				</div>

				<!-- Direction -->
				<div>
					<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
						Direction
					</h3>
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
						<Input
							name="defaults-tone"
							label="Voice direction tone"
							bind:value={form.tone}
							placeholder={dep?.voice_direction_tone
								? `Deployment default (${dep.voice_direction_tone})`
								: 'Deployment default (off)'}
							error={fieldErrors.tone}
						/>
						<Select
							name="defaults-retention"
							label="Audience-retention planner"
							value={form.retentionMode}
							onchange={(e) => pick('retentionMode', e)}
							options={retentionOptions}
							placeholder=""
						/>
						<Select
							name="defaults-timing-tier"
							label="Timing director model tier"
							value={form.timingDirector}
							onchange={(e) => pick('timingDirector', e)}
							options={tierOptions}
							placeholder=""
						/>
					</div>
				</div>
			</fieldset>

			{#if formError}
				<p class="mt-4 text-sm text-status-failed" data-testid="tenant-defaults-error">
					{formError}
				</p>
			{/if}
			{#if canEdit}
				<div class="mt-4 flex justify-end">
					<Button variant="primary" size="sm" onclick={save} disabled={saving}>
						{#if saving}<span class="mr-1.5 inline-block"><Spinner size="sm" /></span>{/if}
						Save defaults
					</Button>
				</div>
			{/if}
		{/if}
	</Card>
</div>
