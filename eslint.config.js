import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default tseslint.config(
	js.configs.recommended,
	...tseslint.configs.recommended,
	...svelte.configs.recommended,
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
				// Injected by vite `define` (vite.config.ts) — declared in src/app.d.ts.
				__APP_VERSION__: 'readonly'
			}
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: tseslint.parser,
				svelteConfig
			}
		}
	},
	{
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			],
			'@typescript-eslint/no-explicit-any': 'off',
			// Enforced as errors (the cleanup pass is done): the codebase is clean
			// of these, so a NEW violation now fails CI instead of hiding in the
			// warning noise. The handful of genuine exceptions — navigation to a
			// runtime/arbitrary URL that resolve() can't type, a reassigned (not
			// mutated) Date — carry explicit inline `eslint-disable-next-line`
			// waivers at their call sites, so every exception is greppable.
			'svelte/no-navigation-without-resolve': 'error',
			'svelte/require-each-key': 'error',
			'svelte/prefer-svelte-reactivity': 'error',
			'svelte/prefer-writable-derived': 'error',
			'svelte/no-unused-svelte-ignore': 'error',
			'@typescript-eslint/no-unused-expressions': 'error'
		}
	},
	{
		ignores: [
			'node_modules/',
			'.worktrees/',
			'.svelte-kit/',
			'build/',
			'dist/',
			'playwright-report/',
			'test-results/',
			'src/lib/api/types.gen.ts',
			'static/'
		]
	}
);
