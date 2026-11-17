import type { RequestHandler } from '@sveltejs/kit';

// Modern Kubernetes liveness probe path (alias of /health/live). The
// frontend is a SvelteKit Node server; "live" = the process accepts
// requests. Readiness for SSR happens at /readyz (which still answers
// 200 because there's no DB/Redis we hard-depend on synchronously).
export const GET: RequestHandler = () => {
	return new Response(JSON.stringify({ status: 'ok' }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
};
