import type { components } from './types.gen';
import { api, ApiError } from './client.js';

type Schemas = components['schemas'];
export type MusicTrack = Schemas['MusicTrack'];
export type MusicTracksResponse = Schemas['MusicTracksResponse'];

/**
 * The music beds available to the caller's tenant (built-in sound-catalog +
 * tenant manifests), from the orchestrator `GET /api/music/tracks`. Resolves to
 * just the `tracks` array; the Studio prepends its own empty-id "no music"
 * option (the endpoint returns only real beds). Callers fall back to the
 * built-in `MUSIC_TRACKS` list on failure so an offline select still works.
 */
export function listMusicTracks(): Promise<MusicTrack[]> {
	return api.get<MusicTracksResponse>('/music/tracks').then((r) => r.tracks);
}

// ---------------------------------------------------------------------------
// Tenant music library (P6 ORCH-4) — `/api/tenant/music`.
//
// GET: any member; returns `{tracks, limits}`. Each track's `url` is the
// same-origin `/api/tenant/music/{id}/content` path (the orchestrator streams the
// bytes from in-cluster MinIO — never a presigned URL, whose host a browser cannot
// resolve). It is browser-fetched by `<audio src>`, so it rides the `kc_token`
// cookie fallback + `scopedMediaUrl` like every other `/api/` media path.
// POST (multipart) / PATCH / DELETE: tenant_admin. The upload's format is SNIFFED
// server-side; `limits` carries every constraint the server enforces (size cap,
// accepted formats, categories, description length), so the UI hardcodes none of
// them. Rights are TENANT-DECLARED: `rights_attested=true` is required, and the
// track is never presented as verified royalty-free.
//
// Hand-mirrored from `src/api/schemas/tenant_music.py` (the pinned OpenAPI package
// predates the route); names avoid the generated `TenantMusicTrack` /
// `TenantMusicList` / `TenantMusicLimits` / `TenantMusicFormat` /
// `TenantMusicPatch`. Alias them on the next codegen bump.
// ---------------------------------------------------------------------------

export const TENANT_SOUND_CATEGORIES = ['music', 'ambient', 'accent', 'transition'] as const;
export type TenantSoundCategoryName = (typeof TENANT_SOUND_CATEGORIES)[number];

/** `TenantMusicTrack`. */
export interface TenantMusicItem {
	id: string;
	/** The catalog id a run references (`tenant_<slug>`). */
	sound_id: string;
	category: TenantSoundCategoryName;
	description: string;
	duration_s: number;
	bytes: number;
	content_type: string;
	rights: 'tenant-declared';
	rights_attested_by: string;
	created_at: string;
	/** Same-origin `/api/tenant/music/{id}/content` stream path. */
	url?: string | null;
}

/** `TenantMusicFormat`. */
export interface TenantMusicFormatItem {
	/** The sniffed container (`mp3` / `wav` / `ogg` / `flac`). */
	format: string;
	extension: string;
	content_type: string;
}

/** `TenantMusicLimits` — the constraints the server enforces on an upload. */
export interface TenantMusicUploadLimits {
	max_bytes: number;
	/** null: no duration cap. */
	max_duration_s?: number | null;
	max_description_length: number;
	categories: TenantSoundCategoryName[];
	formats: TenantMusicFormatItem[];
}

/** `TenantMusicList`. */
export interface TenantMusicItems {
	tracks: TenantMusicItem[];
	limits: TenantMusicUploadLimits;
}

/** `TenantMusicPatch`. */
export interface TenantMusicEdit {
	description?: string | null;
	category?: TenantSoundCategoryName | null;
}

/** The file picker's `accept` hint from the server's formats (the server sniffs
 *  regardless): every content type and every `.extension`, de-duplicated. */
export function tenantMusicAccept(limits: TenantMusicUploadLimits): string {
	const parts = new Set<string>();
	for (const f of limits.formats) {
		if (f.content_type) parts.add(f.content_type);
		if (f.extension) parts.add(f.extension.startsWith('.') ? f.extension : `.${f.extension}`);
	}
	return [...parts].join(',');
}

/** Human list of the accepted formats, e.g. `MP3, WAV, OGG, FLAC`. */
export function tenantMusicFormatLabel(limits: TenantMusicUploadLimits): string {
	return limits.formats.map((f) => f.format.toUpperCase()).join(', ');
}

export interface TenantMusicUpload {
	file: File;
	rightsAttested: boolean;
	category: TenantSoundCategoryName;
	description?: string;
	/** 1–48 chars of a-z, 0-9, _; derived from the filename when omitted. */
	slug?: string;
}

export function tenantMusicForm(u: TenantMusicUpload): FormData {
	const fd = new FormData();
	fd.append('file', u.file);
	fd.append('rights_attested', u.rightsAttested ? 'true' : 'false');
	fd.append('category', u.category);
	if (u.description?.trim()) fd.append('description', u.description.trim());
	if (u.slug?.trim()) fd.append('slug', u.slug.trim());
	return fd;
}

export const tenantMusic = {
	list(): Promise<TenantMusicItems> {
		return api.get<TenantMusicItems>('/tenant/music');
	},
	upload(u: TenantMusicUpload): Promise<TenantMusicItem> {
		// A cap-sized body (default 50 MiB) needs more than the 120s form default on a
		// slow link.
		return api.postForm<TenantMusicItem>('/tenant/music', tenantMusicForm(u), 600_000);
	},
	update(id: string, edit: TenantMusicEdit): Promise<TenantMusicItem> {
		return api.patch<TenantMusicItem>(`/tenant/music/${encodeURIComponent(id)}`, edit);
	},
	remove(id: string): Promise<void> {
		return api.delete<void>(`/tenant/music/${encodeURIComponent(id)}`);
	}
};

export function formatBytes(n: number): string {
	if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
	if (n >= 1024) return `${Math.round(n / 1024)} KiB`;
	return `${n} B`;
}

export function formatDuration(seconds: number): string {
	const s = Math.max(0, Math.round(seconds));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** User copy for an upload / edit / delete error; the API's message wins. */
export function tenantMusicError(err: unknown): string {
	if (!(err instanceof ApiError))
		return err instanceof Error ? err.message : 'Something went wrong.';
	if (err.code === 'FILE_TOO_LARGE') {
		const max = err.details?.max_bytes;
		return typeof max === 'number'
			? `The file is larger than the ${formatBytes(max)} limit.`
			: err.detail;
	}
	if (err.status === 403) return 'Only a workspace admin can change the music library.';
	return err.detail;
}
