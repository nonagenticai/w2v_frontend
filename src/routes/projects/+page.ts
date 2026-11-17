import { loadList } from '$lib/stores/projects.svelte.js';
import type { ProjectListResponse } from '$lib/types';

const SORTABLE = new Set(['created_at', 'finished_at', 'updated_at', 'title', 'status', 'type']);

export async function load({ url }) {
	const page = Number(url.searchParams.get('page') ?? '1');
	const status = url.searchParams.get('status') ?? undefined;
	const type = url.searchParams.get('type') ?? undefined;
	const sortParam = url.searchParams.get('sort') ?? 'created_at';
	const sortBy = SORTABLE.has(sortParam) ? sortParam : 'created_at';
	const order = url.searchParams.get('order') === 'asc' ? 'asc' : 'desc';
	const pageSize = 20;
	const offset = (page - 1) * pageSize;

	// Lessons surface only when explicitly filtered to type=lesson; otherwise the
	// BE excludes child rows (parent_project_id IS NOT NULL).
	const projectList: ProjectListResponse = await loadList({
		status,
		type,
		sortBy,
		order,
		limit: pageSize,
		offset
	});

	return {
		projectList,
		currentPage: page,
		currentStatus: status ?? '',
		currentType: type ?? '',
		currentSort: sortBy,
		currentOrder: order
	};
}
