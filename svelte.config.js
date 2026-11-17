import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({ out: 'build' }),
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				// fonts.googleapis.com hosts the @import'd stylesheet in
				// src/app.css; fonts.gstatic.com hosts the woff2 files that
				// stylesheet references. Without both, the browser blocks
				// the Sora + IBM Plex Mono load and the SPA renders in the
				// fallback system font.
				'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
				'img-src': ['self', 'data:', 'blob:'],
				// TTS voice-preview plays synthesized audio from an object URL
				// (`new Audio(URL.createObjectURL(blob))`). Without media-src this
				// falls back to default-src 'self', which excludes blob: and the
				// browser blocks playback. Mirrors img-src's blob: allowance.
				'media-src': ['self', 'blob:'],
				'font-src': ['self', 'data:', 'https://fonts.gstatic.com'],
				// Narrowed from the `wss:` / `https:` wildcards: WebSocket/HTTPS
				// egress is restricted to the SPA's own origin plus the public
				// Keycloak host. Wildcards would let an XSS payload exfiltrate
				// to any attacker-controlled WSS/HTTPS endpoint.
				'connect-src': [
					'self',
					'https://auth.nonagentic.ai',
					'wss://studio.nonagentic.ai',
					'wss://w2v.nonagentic.ai'
				],
				'frame-ancestors': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'object-src': ['none']
			}
		}
	}
};

export default config;
