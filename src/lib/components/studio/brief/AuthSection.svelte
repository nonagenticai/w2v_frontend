<script lang="ts">
	import { untrack } from 'svelte';
	import { Input } from '$lib/components/ui';
	import { loginChange as changeOf, type LoginChange } from '$lib/studio/login-binding';
	import type { ProjectBrief } from '$lib/types';
	import type { PickType } from '$lib/studio/project-request';

	let {
		type,
		brief = $bindable<ProjectBrief>({})
	}: {
		type: PickType;
		brief?: ProjectBrief;
	} = $props();

	// website_review-only: auth_info nested object. The orchestrator
	// (website_critique stage) reads brief.auth_info and forwards opaquely
	// to analysis_service, which owns the canonical AuthInfo pydantic schema
	// (analysis_service/src/domains/critique/schemas.py::AuthInfo).
	//
	// A STORED secret never comes back: the orchestrator answers `{redacted: true}` in
	// its place (auth_secrets.REDACTED) and keeps the real value as long as that
	// marker is echoed back unchanged. So the field shows the TRUE stored state —
	// "saved" vs "none saved" — and never the marker itself (it rendered as
	// "[object Object]" dots that looked like a typed password).
	type Redacted = { redacted: true };
	type Secret = string | Redacted;
	type SecretKey = 'password' | 'token' | 'cookie_header';
	type AuthInfoShape = {
		type?: 'none' | 'basic' | 'bearer' | 'cookies';
		username?: string;
		password?: Secret;
		token?: Secret;
		cookie_header?: Secret;
		login_url?: string;
		/** The app a single-sign-on login opens (orchestrator `signs_into`). */
		signs_into?: string;
		/** Server flag: the saved secret was dropped because the login changed. */
		needs_reentry?: boolean;
	};
	function authInfo(): AuthInfoShape {
		const ai = brief.auth_info;
		return ai && typeof ai === 'object' ? (ai as AuthInfoShape) : {};
	}
	function isRedacted(v: unknown): v is Redacted {
		return typeof v === 'object' && v !== null && (v as { redacted?: unknown }).redacted === true;
	}
	// What the server held when this form opened: clearing a field you typed into
	// puts the saved secret back instead of erasing it.
	const storedSecrets: Partial<Record<SecretKey, Redacted>> = untrack(() =>
		Object.fromEntries(
			(['password', 'token', 'cookie_header'] as const)
				.filter((k) => isRedacted(authInfo()[k]))
				.map((k) => [k, { redacted: true }])
		)
	);
	// The login a saved secret was approved for. The orchestrator keeps the secret
	// across every other brief edit, but drops it when the login address or the
	// username changes (auth_secrets.restore_redacted) — so the form says so the
	// moment that happens, instead of the password vanishing on save.
	// The login + site a saved secret was approved for. The orchestrator keeps the
	// secret across every other brief edit and drops it when THIS changes — the same
	// rule, mirrored in $lib/studio/login-binding — so the form says so before saving.
	const savedLogin = untrack(() => ({
		login: { ...authInfo() } as Record<string, unknown>,
		context: { ...brief } as Record<string, unknown>
	}));
	function changedLogin(ai: AuthInfoShape): LoginChange | null {
		if (Object.keys(storedSecrets).length === 0) return null;
		return changeOf(
			savedLogin.login,
			savedLogin.context,
			ai as Record<string, unknown>,
			brief as Record<string, unknown>
		);
	}
	const loginChange = $derived(changedLogin(authInfo()));
	/** After a save the SERVER says which login lost its secret (needs_reentry). */
	const serverNeedsReentry = $derived(authInfo().needs_reentry === true);
	const CHANGE_TEXT: Record<LoginChange, string> = {
		address: 'Login address changed',
		username: 'Username changed',
		site: 'The site this sign-in opens changed',
		settings: 'Sign-in settings changed'
	};
	function originOf(url: string | undefined): string | null {
		try {
			return url ? new URL(url).origin : null;
		} catch {
			return null;
		}
	}
	const authType = $derived(authInfo().type ?? 'none');
	// Single sign-on is DECLARED: a sign-in page on another site than the source
	// site only signs into the source site when "Signs into" says so.
	const siteOrigin = $derived(originOf((brief as { source_url?: string }).source_url));
	const ssoUndeclared = $derived(
		authType === 'basic' &&
			!!originOf(authInfo().login_url) &&
			!!siteOrigin &&
			originOf(authInfo().login_url) !== siteOrigin &&
			!authInfo().signs_into
	);
	/** The text a secret input shows: what was typed, never the stored marker. */
	function typed(key: SecretKey): string {
		const v = authInfo()[key];
		return typeof v === 'string' ? v : '';
	}
	function saved(key: SecretKey): boolean {
		return isRedacted(authInfo()[key]);
	}
	function setSecret(key: SecretKey, value: string) {
		setAuthField(key, value === '' && storedSecrets[key] ? storedSecrets[key] : value);
	}
	function setAuthField<K extends keyof AuthInfoShape>(key: K, value: AuthInfoShape[K]) {
		const next: AuthInfoShape = { ...authInfo(), [key]: value };
		// A saved secret belongs to the saved login: never echo it for a changed one
		// (the server would drop it anyway), and put it back if the change is undone.
		for (const k of Object.keys(storedSecrets) as SecretKey[]) {
			if (changedLogin(next)) {
				if (isRedacted(next[k])) delete next[k];
			} else if (next[k] === undefined || next[k] === '') {
				next[k] = storedSecrets[k];
			}
		}
		// When type returns to "none", drop the whole auth_info block so the
		// orchestrator stage's `if auth_info` check sees it as absent.
		if (next.type === 'none' || next.type === undefined) {
			const { auth_info: _unused, ...rest } = brief;
			brief = rest;
			return;
		}
		brief = { ...brief, auth_info: next };
	}
</script>

<!-- Site authentication. For website_review it lets the critique reach
     pages behind a login (maps 1:1 to analysis_service AuthInfo: basic /
     bearer / cookies). For promo it lets the Playwright recorder sign in
     to the SPA before recording (login_url drives an interactive form
     login on the recorder side). Same field shape either way. -->
{#snippet secretStatus(key: 'password' | 'token' | 'cookie_header', what: string)}
	{#if (loginChange && storedSecrets[key] && !typed(key)) || (serverNeedsReentry && !typed(key) && !saved(key))}
		<p class="mt-1 text-xs text-[var(--color-warning-text)]" data-testid="auth-{key}-login-changed">
			{loginChange ? CHANGE_TEXT[loginChange] : 'The sign-in changed'} — re-enter the {what}. The
			saved one was for the previous sign-in, so the recording cannot sign in until you do.
		</p>
	{:else if saved(key)}
		<p class="mt-1 text-xs text-[var(--color-success-text)]" data-testid="auth-{key}-saved">
			A {what} is saved for this project. Leave this empty to keep it, or type a new one to replace it.
		</p>
	{:else if !typed(key)}
		<p class="mt-1 text-xs text-[var(--color-warning-text)]" data-testid="auth-{key}-missing">
			No {what} is saved. Enter it, or the {type === 'promo' ? 'recording' : 'review'} cannot sign in.
		</p>
	{/if}
{/snippet}

<fieldset class="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
	<legend class="px-2 text-sm font-medium text-[var(--color-text-muted)]">
		{type === 'promo' ? 'Source site sign-in' : 'Target site authentication'}
	</legend>
	<p class="text-xs text-[var(--color-text-muted)]">
		{type === 'promo'
			? 'Only needed if the source site requires sign-in to record. With a sign-in page URL, the password is typed only into that page; without one, it is sent only to your source site, as HTTP Basic. If the sign-in fails, the run stops and tells you, instead of recording the sign-in screen.'
			: 'Use only for sites that require sign-in. Credentials are stored per-job in the analysis service and sent only to your target URL.'}
	</p>

	<div>
		<label for="auth-type" class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5">
			Sign-in method
		</label>
		<select
			id="auth-type"
			data-testid="auth-type-select"
			value={authType}
			onchange={(e) =>
				setAuthField('type', (e.currentTarget as HTMLSelectElement).value as AuthInfoShape['type'])}
			class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
		>
			<option value="none">None (public site)</option>
			<option value="basic">Username + password</option>
			<option value="bearer">Bearer token</option>
			<option value="cookies">Session cookie</option>
		</select>
	</div>

	{#if authType === 'basic'}
		<Input
			name="auth-username"
			label="Username"
			value={authInfo().username ?? ''}
			oninput={(e) => setAuthField('username', (e.currentTarget as HTMLInputElement).value)}
		/>
		<div>
			<label
				for="auth-password"
				class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
			>
				Password
			</label>
			<input
				id="auth-password"
				name="auth-password"
				type="password"
				autocomplete="off"
				placeholder={saved('password') ? 'Saved — leave empty to keep' : ''}
				value={typed('password')}
				oninput={(e) => setSecret('password', (e.currentTarget as HTMLInputElement).value)}
				class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
			/>
			{@render secretStatus('password', 'password')}
		</div>
	{:else if authType === 'bearer'}
		<div>
			<label
				for="auth-token"
				class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
			>
				Bearer token
			</label>
			<input
				id="auth-token"
				name="auth-token"
				type="password"
				autocomplete="off"
				placeholder={saved('token') ? 'Saved — leave empty to keep' : ''}
				value={typed('token')}
				oninput={(e) => setSecret('token', (e.currentTarget as HTMLInputElement).value)}
				class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
			/>
			<p class="mt-1 text-xs text-[var(--color-text-muted)]">
				Sent as <code>Authorization: Bearer &lt;token&gt;</code>.
			</p>
			{@render secretStatus('token', 'token')}
		</div>
	{:else if authType === 'cookies'}
		<div>
			<label
				for="auth-cookie-header"
				class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
			>
				Cookie header
			</label>
			<textarea
				id="auth-cookie-header"
				name="auth-cookie-header"
				rows="3"
				placeholder={saved('cookie_header')
					? 'Saved — leave empty to keep'
					: 'session=abc123; csrf=xyz789'}
				value={typed('cookie_header')}
				oninput={(e) => setSecret('cookie_header', (e.currentTarget as HTMLTextAreaElement).value)}
				class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
			></textarea>
			<p class="mt-1 text-xs text-[var(--color-text-muted)]">
				Paste the raw <code>Cookie:</code> header from a logged-in browser session (DevTools → Network
				→ request headers).
			</p>
			{@render secretStatus('cookie_header', 'cookie header')}
		</div>
	{/if}

	{#if authType !== 'none'}
		<Input
			name="auth-login-url"
			label={type === 'promo'
				? 'Sign-in page URL (optional — the recorder signs in here before recording; single sign-on pages work)'
				: 'Login URL (optional, informational)'}
			placeholder="https://example.com/login"
			value={authInfo().login_url ?? ''}
			oninput={(e) => setAuthField('login_url', (e.currentTarget as HTMLInputElement).value)}
		/>
		{#if type === 'promo' && authType === 'basic' && authInfo().login_url}
			<Input
				name="auth-signs-into"
				label="Signs into (the app this sign-in opens, if the sign-in page is on another site)"
				placeholder={siteOrigin ?? 'https://app.example.com'}
				value={authInfo().signs_into ?? ''}
				oninput={(e) =>
					setAuthField('signs_into', (e.currentTarget as HTMLInputElement).value || undefined)}
			/>
			{#if ssoUndeclared}
				<p class="text-xs text-[var(--color-warning-text)]" data-testid="auth-signs-into-missing">
					The sign-in page is on {new URL(authInfo().login_url ?? '').host}, not your source site.
					Say which app it signs you into, or the recording stays signed out.
					<button
						type="button"
						class="ml-1 font-semibold underline"
						data-testid="auth-signs-into-use-source"
						onclick={() => setAuthField('signs_into', siteOrigin ?? undefined)}
						>Use {siteOrigin}</button
					>
				</p>
			{/if}
		{/if}
	{/if}
</fieldset>
