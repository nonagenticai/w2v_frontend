import { env } from '$env/dynamic/private';

export const API_URL = env.W2V_API_URL ?? 'http://localhost:6300';
// Web-design capability moved out of analysis_service (was REDESIGN_URL:6306)
// into the standalone html_render_service, served at /api/designs on :6319.
export const HTML_RENDER_URL = env.W2V_HTML_RENDER_URL ?? 'http://localhost:6319';
export const TEST_RUNNER_URL = env.W2V_TEST_RUNNER_URL ?? 'http://localhost:6316';
