// Toast notification store (Svelte 5 runes)

import { randomId } from '$lib/utils/random-id.js';

interface ToastItem {
	id: string;
	variant: 'success' | 'error' | 'info' | 'warning';
	title: string;
	description?: string;
	duration: number;
}

let toasts = $state<ToastItem[]>([]);

// Module-level timer registry; not part of reactive state.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function addToast(item: Omit<ToastItem, 'id' | 'duration'> & { duration?: number }): string {
	// `crypto.randomUUID()` here threw on a non-secure origin — and because the
	// toast is what a failing save falls back to, the throw happened INSIDE the
	// caller's catch and erased the only user-visible trace of the failure.
	const id = randomId();
	const duration = item.duration ?? (item.variant === 'error' ? 8000 : 5000);
	toasts = [...toasts, { ...item, id, duration }];

	const timer = setTimeout(() => {
		removeToast(id);
	}, duration);
	timers.set(id, timer);

	return id;
}

export function removeToast(id: string): void {
	const timer = timers.get(id);
	if (timer) {
		clearTimeout(timer);
		timers.delete(id);
	}
	toasts = toasts.filter((t) => t.id !== id);
}

export function getToasts(): ToastItem[] {
	return toasts;
}

export function toastSuccess(title: string, description?: string): string {
	return addToast({ variant: 'success', title, description });
}

export function toastError(title: string, description?: string): string {
	return addToast({ variant: 'error', title, description, duration: 8000 });
}

export function toastInfo(title: string, description?: string): string {
	return addToast({ variant: 'info', title, description });
}

export function toastWarning(title: string, description?: string): string {
	return addToast({ variant: 'warning', title, description });
}

export type { ToastItem };
