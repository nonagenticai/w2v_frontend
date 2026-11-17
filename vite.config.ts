import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
	// Build version for the operator-only sidebar footer (SidebarNav.svelte), from
	// package.json rather than a literal in the template.
	define: { __APP_VERSION__: JSON.stringify(pkg.version) },
	plugins: [tailwindcss(), sveltekit()],
	server: {
		port: 6183,
		host: true
	}
});
