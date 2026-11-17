// Course chapter-title + thumbnail override API (orchestrator).
//
// Overrides live as JSONB keys on the run's `course_stitch` stage output, so
// every endpoint returns the updated `StageOutputResponse` (artifact URLs
// already proxy-rewritten) — the caller swaps it into the page output to
// refresh titles / poster without a full reload.
//
//   PATCH /api/runs/{run_id}/stages/course_stitch/chapters
//     body: { overrides: { <chapter_key>: <title> }, hidden?: <chapter_key[]> }
//       overrides edits lesson (level-0) + slide (level-1) titles by chapter_key;
//       hidden (omit = leave untouched) is the full set of level-1 keys to drop
//       from the published YouTube chapters + the in-app player.
//   PATCH /api/runs/{run_id}/stages/course_stitch/thumbnail
//     body: { thumbnail_url: <artifact url> | null }          (null = revert)
//   POST  /api/uploads/thumbnail  (multipart)  → { thumbnail_url, bytes }

import { api } from './client.js';
import type { StageOutputResponse } from '$lib/types/runs';

export interface ThumbnailUploadResponse {
	thumbnail_url: string;
	bytes: number;
}

export const course = {
	patchChapters(
		runId: string,
		overrides: Record<string, string>,
		hidden?: string[]
	): Promise<StageOutputResponse> {
		return api.patch<StageOutputResponse>(`/runs/${runId}/stages/course_stitch/chapters`, {
			overrides,
			...(hidden !== undefined ? { hidden } : {})
		});
	},

	patchThumbnail(runId: string, thumbnailUrl: string | null): Promise<StageOutputResponse> {
		return api.patch<StageOutputResponse>(`/runs/${runId}/stages/course_stitch/thumbnail`, {
			thumbnail_url: thumbnailUrl
		});
	},

	uploadThumbnail(file: Blob, filename = 'thumbnail.png'): Promise<ThumbnailUploadResponse> {
		const form = new FormData();
		const named =
			file instanceof File ? file : new File([file], filename, { type: file.type || 'image/png' });
		form.append('file', named);
		return api.postForm<ThumbnailUploadResponse>('/uploads/thumbnail', form);
	}
};
