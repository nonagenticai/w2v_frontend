import type { HealthResponse, ConfigStatusResponse, DownstreamHealthResponse } from '$lib/types';
import { ApiError, api } from './client.js';

// Health endpoints moved to /health (outside the /api prefix).
// The api helper prepends /api, so we use a direct fetch for the
// new top-level /health routes.

async function healthGet<T>(path: string): Promise<T> {
	const response = await fetch(path, {
		headers: { 'Content-Type': 'application/json' }
	});
	if (!response.ok) {
		// Callers (e.g. fetchUser in auth.svelte.ts) branch on `.status` of an
		// ApiError to decide whether the backend is down vs the user is unauth.
		// A plain Error would leave that branch reading `undefined`.
		throw new ApiError(
			response.status,
			response.statusText,
			`Health check failed: ${response.status}`
		);
	}
	return response.json() as Promise<T>;
}

export const health = {
	/** GET /health */
	check(): Promise<HealthResponse> {
		return healthGet<HealthResponse>('/health');
	},
	/** GET /health/live */
	live(): Promise<{ status: string }> {
		return healthGet<{ status: string }>('/health/live');
	},
	/** GET /health/ready */
	ready(): Promise<{ status: string }> {
		return healthGet<{ status: string }>('/health/ready');
	},
	/** GET /api/health/downstream (via pipeline API) */
	downstream(): Promise<DownstreamHealthResponse> {
		return api.get<DownstreamHealthResponse>('/health/downstream');
	}
	// NOTE: /health/device-farm does not exist on the orchestrator.
	// Device farm health was removed. Use downstream() to check service health.
};

export const config = {
	getStatus(): Promise<ConfigStatusResponse> {
		return api.get<ConfigStatusResponse>('/config/status');
	}
};
