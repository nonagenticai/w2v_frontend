// Settings store — persisted to localStorage (Svelte 5 runes)

const STORAGE_KEY = 'w2v_settings';

interface ThemeSettings {
	name: string;
}

// Projects list page view preference. Persisted so the chosen layout + sort
// survive reloads and navigation.
export type ProjectsLayout = 'gallery' | 'list';
export interface ProjectsViewSettings {
	layout: ProjectsLayout;
	sortBy: string;
	order: 'asc' | 'desc';
}

export interface AppSettings {
	theme: ThemeSettings;
	projectsView: ProjectsViewSettings;
}

const defaults: AppSettings = {
	theme: { name: 'default' },
	projectsView: { layout: 'gallery', sortBy: 'created_at', order: 'desc' }
};

// Keys an earlier build persisted for retired /settings sections, dropped on read
// so the purge below rewrites storage without them:
//   - features / imageGen / videoGen: the "AI Generation" section (provider names
//     + API keys nothing read; real connections live server-side on /providers) —
//     an old `imageGen.apiKey` must not linger in browser storage forever.
//   - crawl / narration / video: the browser-only "Default Config", Narration and
//     Video Output cards, replaced by the server-backed workspace defaults
//     (/api/tenant/defaults, P6 FE-1). Forward-only: old values are not migrated.
//   - deviceFarm / apiKeys: the browser-only Device Farm card and the legacy
//     API-key bag — read by nothing; the device farm is the server-side
//     `device_farm` slot on /providers. Older builds wrote BrowserStack
//     credentials / API keys here in plaintext, so they must be purged.
const RETIRED_KEYS = [
	'features',
	'imageGen',
	'videoGen',
	'crawl',
	'narration',
	'video',
	'deviceFarm',
	'apiKeys'
] as const;

function withoutRetiredKeys(raw: Record<string, unknown>): Record<string, unknown> {
	const out = { ...raw };
	for (const k of RETIRED_KEYS) delete out[k];
	return out;
}

function loadFromStorage(): AppSettings {
	if (typeof window === 'undefined') return structuredClone(defaults);
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return structuredClone(defaults);
		const stored = JSON.parse(raw) as Record<string, unknown>;
		const merged = { ...structuredClone(defaults), ...stored } as AppSettings;
		const clean = {
			...structuredClone(defaults),
			...withoutRetiredKeys(stored)
		} as AppSettings;
		// Purge retired keys (incl. legacy plaintext credentials) written by an earlier build.
		if (JSON.stringify(clean) !== JSON.stringify(merged)) {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
			} catch {
				/* storage full / blocked — the in-memory value is already clean */
			}
		}
		return clean;
	} catch {
		return structuredClone(defaults);
	}
}

function saveToStorage(s: AppSettings): void {
	if (typeof window === 'undefined') return;
	// Storage full / blocked (private mode, sandboxed iframe) must not break the
	// page: the in-memory value still applies for this session.
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
	} catch {
		/* not persisted — preference lasts for this session only */
	}
}

let settings = $state<AppSettings>(loadFromStorage());

export function getSettings(): AppSettings {
	return settings;
}

export function updateTheme(patch: Partial<ThemeSettings>): void {
	settings = { ...settings, theme: { ...settings.theme, ...patch } };
	saveToStorage(settings);
}

export function updateProjectsView(patch: Partial<ProjectsViewSettings>): void {
	settings = { ...settings, projectsView: { ...settings.projectsView, ...patch } };
	saveToStorage(settings);
}

export function getThemeName(): string {
	return settings.theme.name;
}

export function toggleTheme(): void {
	const current = settings.theme.name;
	// Cycle: default -> dark -> light -> default
	const next = current === 'default' ? 'dark' : current === 'dark' ? 'light' : 'default';
	updateTheme({ name: next });
}

export function resetToDefaults(): void {
	settings = structuredClone(defaults);
	saveToStorage(settings);
}
