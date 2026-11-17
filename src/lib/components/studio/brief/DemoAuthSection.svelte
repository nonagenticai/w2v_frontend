<script lang="ts">
	import { Input } from '$lib/components/ui';
	import type { ProjectBrief } from '$lib/types';

	let {
		brief = $bindable<ProjectBrief>({})
	}: {
		brief?: ProjectBrief;
	} = $props();

	// demo_video-only: login-gated demo auth. DISTINCT from auth_info — the demo
	// recorder (frontend_test_runner_service) performs an interactive Playwright
	// form login (storageState), so the shape is the FTR AuthConfig
	// {type, login_url, username, password}, not the critique AuthInfo. The
	// orchestrator forwards brief.auth_config to bdd (gen) + FTR (record).
	type AuthConfigShape = {
		type?: 'none' | 'form';
		login_url?: string;
		username?: string;
		password?: string;
	};
	function authConfig(): AuthConfigShape {
		const ac = brief.auth_config;
		return ac && typeof ac === 'object' ? (ac as AuthConfigShape) : {};
	}
	function setAuthConfigField<K extends keyof AuthConfigShape>(key: K, value: AuthConfigShape[K]) {
		const next: AuthConfigShape = { ...authConfig(), [key]: value };
		// "none" → drop the whole block so the gen/record stages' `if auth_config`
		// presence check (and FTR's auth.setup.ts gating) see it as absent.
		if (next.type === 'none' || next.type === undefined) {
			const { auth_config: _unused, ...rest } = brief;
			brief = rest;
			return;
		}
		brief = { ...brief, auth_config: next };
	}
	const demoAuthType = $derived(authConfig().type ?? 'none');
</script>

<!-- Login-gated demo auth. The demo recorder signs in via an interactive
     Playwright form login (storageState) before walking the scenarios, so
     the shape is FTR AuthConfig {type, login_url, username, password} —
     NOT the auth_info critique shape. Credentials are sent only to your
     target URL's login page. Shared by demo_video + showcase (same stages). -->
<fieldset class="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
	<legend class="px-2 text-sm font-medium text-[var(--color-text-muted)]"> Demo sign-in </legend>
	<p class="text-xs text-[var(--color-text-muted)]">
		Only needed if the app requires login to reach the flows you want demoed. The recorder submits
		the login form once, then records the authenticated walkthrough. Credentials are sent only to
		your target URL.
	</p>

	<div>
		<label
			for="demo-auth-type"
			class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
		>
			Demo requires login?
		</label>
		<select
			id="demo-auth-type"
			data-testid="demo-auth-type-select"
			value={demoAuthType}
			onchange={(e) =>
				setAuthConfigField(
					'type',
					(e.currentTarget as HTMLSelectElement).value as AuthConfigShape['type']
				)}
			class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
		>
			<option value="none">No (public app)</option>
			<option value="form">Yes — form login (username + password)</option>
		</select>
	</div>

	{#if demoAuthType === 'form'}
		<Input
			name="demo-auth-login-url"
			label="Login URL"
			placeholder="https://example.com/login"
			value={authConfig().login_url ?? ''}
			oninput={(e) => setAuthConfigField('login_url', (e.currentTarget as HTMLInputElement).value)}
		/>
		<Input
			name="demo-auth-username"
			label="Username / email"
			value={authConfig().username ?? ''}
			oninput={(e) => setAuthConfigField('username', (e.currentTarget as HTMLInputElement).value)}
		/>
		<div>
			<label
				for="demo-auth-password"
				class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
			>
				Password
			</label>
			<input
				id="demo-auth-password"
				name="demo-auth-password"
				type="password"
				autocomplete="off"
				value={authConfig().password ?? ''}
				oninput={(e) => setAuthConfigField('password', (e.currentTarget as HTMLInputElement).value)}
				class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
			/>
		</div>
	{/if}
</fieldset>
