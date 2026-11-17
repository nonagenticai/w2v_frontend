import type { RequestHandler } from '@sveltejs/kit';

// Modern Kubernetes readiness probe path. SvelteKit SSR has no
// hard synchronous dependencies (DB / Redis), so readiness collapses
// onto liveness for the frontend. If the Node process is accepting
// requests, it can render. Backend API reachability is checked by
// the orchestrator's own /readyz upstream.
export const GET: RequestHandler = () => {
	return new Response(JSON.stringify({ status: 'ready' }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
};
