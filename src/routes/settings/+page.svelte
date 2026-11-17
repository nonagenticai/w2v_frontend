<script lang="ts">
	// /settings holds only what is real: the server-backed workspace defaults
	// (TenantDefaultsCard → /api/tenant/defaults, P6 FE-1) and the browser-local
	// interface preferences (interface theme, projects layout). The reset button lives
	// INSIDE the "This browser" card, next to the only controls it resets.
	//
	// "Interface theme" is the app's colour scheme. It is NOT the video theme a
	// project picks in the wizard (Review step → "Video theme") — two different things.
	//
	// Everything a workspace CONNECTS lives on /providers (tenant_admin only), driven
	// by the server's provider manifest: LLM / TTS / image / video connections, the
	// device farm (a real `device_farm` slot — the old browser-only Device Farm card
	// here was read by nothing) and the YouTube publishing grant (YouTubeGrantCard,
	// gated on tenant_admin AND on the API offering the slot — the old Connect button
	// here offered it to every user regardless).
	import {
		getSettings,
		getThemeName,
		resetToDefaults,
		updateProjectsView,
		updateTheme,
		type ProjectsLayout
	} from '$lib/stores/settings.svelte.js';
	import { toastSuccess } from '$lib/stores/toast.svelte.js';
	import { Card, Button, Dialog, Select } from '$lib/components/ui';
	import { RotateCcw, Plug, ChevronRight, Monitor } from '@lucide/svelte';
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	import TenantDefaultsCard from '$lib/components/settings/TenantDefaultsCard.svelte';
	import { resolve } from '$app/paths';
	import { isTenantAdmin } from '$lib/stores/auth.svelte';

	const themeOptions = [
		{ value: 'default', label: 'System' },
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' }
	];
	const layoutOptions = [
		{ value: 'gallery', label: 'Gallery' },
		{ value: 'list', label: 'List' }
	];
	const themeName = $derived(getThemeName());
	const projectsLayout = $derived(getSettings().projectsView.layout);

	// Reset wipes the browser preferences with no way back, so it confirms.
	let resetOpen = $state(false);
	function confirmReset() {
		resetOpen = false;
		resetToDefaults();
		toastSuccess('Browser preferences reset');
	}
</script>

<svelte:head>
	<title>Settings - Studio</title>
</svelte:head>

<Page width="narrow" testid="settings-home">
	<PageHeader
		kicker="Workspace"
		title="Settings"
		subtitle="Production defaults for every new project in this workspace, plus how the app looks in this browser."
	/>

	<!-- Providers — every /api/tenant/connections route is behind TenantAdminDep, so a
	     member gets a note instead of a link that would only show an error. -->
	{#if isTenantAdmin()}
		<a href={resolve('/providers')} class="block" data-testid="settings-providers-link">
			<Card hover class="flex items-center justify-between p-5">
				<div class="flex items-center gap-3">
					<Plug class="h-5 w-5 text-text-muted" />
					<div>
						<h2 class="text-sm font-semibold text-text">Providers</h2>
						<p class="text-xs text-text-muted">
							Connect your own LLM, voice, image and device-farm providers, and your YouTube channel
							— or keep the platform defaults.
						</p>
					</div>
				</div>
				<ChevronRight class="h-4 w-4 text-text-muted" />
			</Card>
		</a>
	{:else}
		<Card class="p-5">
			<div class="flex items-center gap-3" data-testid="settings-providers-admin-only">
				<Plug class="h-5 w-5 text-text-muted" />
				<p class="text-sm text-text-muted">
					Providers, the device farm and YouTube publishing are managed by a workspace admin on the
					Providers page.
				</p>
			</div>
		</Card>
	{/if}

	<!-- Workspace production defaults — server-backed (P6 FE-1). -->
	<TenantDefaultsCard />

	<!-- Browser-local interface preferences + the reset that clears exactly these. -->
	<Card class="p-5">
		<div class="space-y-4" data-testid="browser-preferences">
			<div class="flex items-start gap-3">
				<Monitor class="mt-0.5 h-5 w-5 text-text-muted" />
				<div>
					<h2 class="text-sm font-semibold text-text">This browser</h2>
					<p class="text-xs text-text-muted">
						Stored only in this browser, not shared with your workspace. The app colour scheme is
						the same setting as the header's interface theme toggle; a video's look is set per
						project ("Video theme").
					</p>
				</div>
			</div>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<Select
					label="App colour scheme"
					name="app-colour-scheme"
					placeholder=""
					value={themeName}
					options={themeOptions}
					onchange={(e) => updateTheme({ name: (e.target as HTMLSelectElement).value })}
				/>
				<Select
					label="Projects list layout"
					name="projects-layout"
					placeholder=""
					value={projectsLayout}
					options={layoutOptions}
					onchange={(e) =>
						updateProjectsView({
							layout: (e.target as HTMLSelectElement).value as ProjectsLayout
						})}
				/>
			</div>
			<div class="flex justify-end">
				<Button variant="secondary" size="sm" onclick={() => (resetOpen = true)}>
					<RotateCcw class="h-4 w-4" />
					Reset browser preferences
				</Button>
			</div>
		</div>
	</Card>
</Page>

<!-- Gated on the flag: the <dialog> subtree stays mounted when closed. -->
<Dialog bind:open={resetOpen} title="Reset browser preferences?">
	{#if resetOpen}
		<div class="flex flex-col gap-4" data-testid="settings-reset-confirm">
			<p class="text-sm text-text">
				This puts the interface theme and the projects list layout back to their defaults in this
				browser. It cannot be undone. Workspace defaults are stored on the server and are not
				affected.
			</p>
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (resetOpen = false)}>Cancel</Button>
				<Button variant="danger" size="sm" onclick={confirmReset}>Reset preferences</Button>
			</div>
		</div>
	{/if}
</Dialog>
