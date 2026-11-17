import { API_URL } from '$lib/server/config';
import type { RequestHandler } from './$types';

async function proxy({ request, url }: { request: Request; url: URL }): Promise<Response> {
	const targetUrl = `${API_URL}${url.pathname}${url.search}`;

	const headers = new Headers(request.headers);
	headers.delete('host');

	try {
		const response = await fetch(targetUrl, {
			method: request.method,
			headers
		});

		const responseHeaders = new Headers(response.headers);
		responseHeaders.delete('transfer-encoding');

		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: responseHeaders
		});
	} catch {
		return new Response(JSON.stringify({ status: 'unavailable' }), {
			status: 503,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}

export const GET: RequestHandler = (event) => proxy(event);
