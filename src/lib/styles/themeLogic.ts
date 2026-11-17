// Pure theme helpers shared by the root layout (and any future theme UI).
// Adapted from fr's themeLogic for w2v's model: the persisted theme name is
// 'default' | 'dark' | 'light' (see stores/settings.svelte.ts); 'default'
// follows the OS preference.
//
// The app themes via TWO mechanisms during the rearchitecture: the legacy
// `data-theme` attribute (drives the old warm-orange tokens in app.css) and the
// fr `.dark` class (drives the ported fr tokens in tokens.css). applyTheme
// writes BOTH, mirroring the pre-hydration logic in static/theme-init.js.

export type ThemeName = 'default' | 'dark' | 'light';
export type EffectiveTheme = 'light' | 'dark';

export function resolveTheme(name: string, systemPrefersDark: boolean): EffectiveTheme {
	if (name === 'dark') return 'dark';
	if (name === 'light') return 'light';
	return systemPrefersDark ? 'dark' : 'light';
}

export function applyTheme(root: HTMLElement, effective: EffectiveTheme): void {
	root.setAttribute('data-theme', effective);
	root.classList.toggle('dark', effective === 'dark');
}
