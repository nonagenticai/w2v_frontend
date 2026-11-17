import { browser } from '$app/environment';
import { ensureAuthReady } from '$lib/stores/auth.svelte.js';

export const ssr = false;
export const prerender = false;

export async function load(): Promise<Record<string, never>> {
	// Wait for Keycloak check-SSO + token attachment to finish before any
	// child +page.ts load fires its own authenticated fetch. Without this, the
	// first navigation to /pipelines (or any other protected page) races
	// against auth init: the page's load runs with no Authorization header,
	// gets a 401, and the user sees an empty page.
	if (browser) {
		await ensureAuthReady();
	}
	return {};
}
