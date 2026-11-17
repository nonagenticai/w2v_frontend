// Turn a media-discovery search result into a pinned ProjectSource.
//
// WHY this exists: the Review step shows thumbnails of what the operator pinned,
// so the pin must carry `thumbnail_url` (+ `media_type` to badge clips) through
// `brief.sources[]` — not just `ref`/`label`. The orchestrator's source_ingest
// ignores the extra fields (the brief is a free-form dict), so this is purely a
// UI convenience. Kept as a pure function so the mapping is unit-tested without
// driving the MediaFinder component's bindable state.

import type { MediaResult } from '$lib/api';
import type { ProjectSource } from '$lib/types';

/** The canonical ref for a media item: its URL, falling back to its id. */
export function mediaResultRef(item: MediaResult): string {
	return item.url || item.id;
}

/** Build the {kind:'media'} source pinned into brief.sources for a result. */
export function mediaResultToSource(item: MediaResult): ProjectSource {
	return {
		kind: 'media',
		ref: mediaResultRef(item),
		label: item.title || item.source,
		thumbnail_url: item.thumbnail_url || undefined,
		media_type: item.media_type || undefined
	};
}
