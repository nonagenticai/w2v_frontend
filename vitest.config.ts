import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
	// Build version for the operator-only sidebar footer (SidebarNav.svelte), from
	// package.json rather than a literal in the template.
	define: { __APP_VERSION__: JSON.stringify(pkg.version) },
	plugins: [sveltekit()],
	resolve: {
		conditions: ['browser']
	},
	test: {
		environment: 'happy-dom',
		globals: true,
		// `e2e/**/*.test.ts` holds unit tests for the E2E *harness itself* (not the
		// Playwright specs, which are `e2e/tests/*.spec.ts` and never match `.test.ts`).
		// The harness has its own failure modes — a dropped port-forward can fail a
		// healthy run — so it gets the same regression cover as src.
		include: ['src/**/*.test.ts', 'e2e/**/*.test.ts'],
		setupFiles: ['./vitest.setup.ts']
	}
});
