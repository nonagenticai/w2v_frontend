// Sidebar UI state (Svelte 5 runes). Tracks the desktop collapsed/expanded
// rail and persists it to localStorage so the choice survives reloads. Kept
// deliberately minimal — fr's pin/badge/super-admin machinery isn't needed for
// w2v's small nav. The mobile drawer (open/close) stays local to the layout.

const STORAGE_KEY = 'w2v_sidebar_collapsed';

function loadCollapsed(): boolean {
	if (typeof localStorage === 'undefined') return false;
	return localStorage.getItem(STORAGE_KEY) === '1';
}

class SidebarStore {
	collapsed = $state<boolean>(loadCollapsed());

	toggleCollapsed(): void {
		this.collapsed = !this.collapsed;
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(STORAGE_KEY, this.collapsed ? '1' : '0');
		}
	}
}

export const sidebar = new SidebarStore();
