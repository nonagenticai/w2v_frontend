// Pipeline-aligned types (new API)
export type {
	PipelineStatus,
	StageStatus,
	PipelineMode,
	PipelineWebSocketEvent,
	CreatePipelineRequest,
	StageExecutionResponse,
	ArtifactResponse,
	PipelineVideo,
	AssetProvenance,
	VisualAsset,
	SlideDeckSlideAsset,
	SlideDeckManifest,
	SlideDeckArtifact,
	FrontendTestSummary,
	FrontendTestCaseResult,
	FrontendTestArtifact,
	CancelPipelineResponse,
	DownstreamHealthResponse
} from './api.js';

// Legacy types (kept for backward compatibility)
export type {
	CritiqueRunStatus,
	CritiqueCategory,
	CritiqueSeverity,
	AppInputType,
	AppUploadResponse,
	DeviceFarmProvider,
	DeviceFarmDevice,
	DeviceFarmHealthResponse,
	CritiqueFinding,
	CritiqueResponse,
	CritiqueList,
	RedesignJobStatus,
	RedesignJob,
	RedesignVariant,
	RedesignResult,
	HealthComponentStatus,
	HealthResponse,
	ConfigStatusResponse,
	DashboardStats,
	StorylineChapter,
	CourseChapter,
	ReviewCategory,
	ScoredReview,
	FeatureReview,
	FeatureSuggestion,
	FeatureSuggestionsReview,
	JobReviews,
	YouTubePrivacyStatus,
	YouTubeAuthStatusResponse,
	YouTubeConnectionState,
	YouTubeMode,
	YouTubeUploadRequest,
	YouTubeUploadJobResponse
} from './api.js';

// Studio: Project + Deliverable (BE phase 1; recursion + clone in BE phase 8)
export type {
	ProjectType,
	ProjectStatus,
	RunStatus,
	DeliverableFormat,
	CaptionsMode,
	DeliverableStatus,
	ProjectBrief,
	ShowcaseLine,
	ProjectSource,
	Shot,
	UrlShot,
	SlideShot,
	ShotViewport,
	BrandConfig,
	VoiceConfig,
	ThemeConfig,
	DeliverableResponse,
	ProjectResponse,
	ProjectDetailResponse,
	ProjectListResponse,
	DeliverableInput,
	CreateProjectRequest,
	UpdateProjectRequest,
	CreateChildProjectRequest,
	ReorderChildrenRequest,
	LessonSummary,
	CreateDeliverableRequest,
	DeliverableUpdateRequest,
	DeliverableStartResponse
} from './api.js';

export { PROJECT_TYPE_LABELS, DELIVERABLE_FORMAT_LABELS, CAPTIONS_MODE_LABELS } from './api.js';

// Studio: Stage drafts (BE phase 2; mutation verbs land in F3)
export type { StageDraftSource, StageDraft, StageDraftListResponse } from './api.js';
export { STAGE_DRAFT_SOURCE_LABELS } from './api.js';

// Studio: Stage steering verbs (BE phase 3)
// `CheckpointsRequest` / `CheckpointsResponse` are NOT re-exported here — use the
// generated `CheckpointsResponse` / `CheckpointsUpdate` from `$lib/api/runs`.

// Studio: Stage element CRUD (BE phase 4)
export type {
	StageElement,
	ElementInsertRequest,
	ElementUpdateRequest,
	ElementReorderRequest,
	ElementListResponse,
	ElementResponse,
	ElementMutationResponse,
	ElementCapableStage
} from './api.js';
export { ELEMENT_SPECS } from './api.js';

// Studio: Verbatim items (BE phase 6)
export type {
	VerbatimKind,
	VerbatimScope,
	VerbatimStatus,
	VerbatimItemResponse,
	VerbatimItemListResponse,
	VerbatimItemCreateRequest,
	VerbatimItemUpdateRequest,
	VerbatimItemRunStartRequest
} from './api.js';
export {
	VERBATIM_KIND_LABELS,
	VERBATIM_SCOPE_LABELS,
	VERBATIM_STATUS_LABELS,
	VERBATIM_CARRIER_STAGES
} from './api.js';

// Studio: Storyboard panels (Phase 0)
export type {
	PanelStatus,
	ShotSize,
	CameraAngle,
	CameraMovement,
	TransitionOut,
	VisualType,
	StoryboardPanelResponse,
	StoryboardPanelListResponse,
	StoryboardPanelCreate,
	StoryboardPanelUpdate,
	ReorderPanelsRequest,
	StoryboardPanelDraft
} from './api.js';

// Studio: Storyboard assets, scenes, draft + rewrite (Phase 1)
export type {
	AssetKind,
	StoryboardAssetResponse,
	StoryboardAssetListResponse,
	StoryboardAssetCreate,
	StoryboardAssetUpdate,
	StoryboardSceneResponse,
	StoryboardSceneListResponse,
	StoryboardSceneCreate,
	StoryboardSceneUpdate,
	StoryboardDraftRequest,
	StoryboardDraftResponse,
	PanelRewriteRequest,
	PanelEvent,
	PanelEventListResponse
} from './api.js';

// Studio: per-panel AI image generation
export type {
	MediaRef,
	PanelGen,
	PanelImageRequest,
	PanelImageJobResponse,
	PanelImageStatus
} from './api.js';

// Studio: Storyboard version snapshots (snapshot / restore)
export type {
	SnapshotKind,
	StoryboardSnapshot,
	SnapshotCreateRequest,
	SnapshotListResponse,
	RestoreResponse
} from './api.js';

// Studio: Storyboard branches (fork the board, rework, merge back)
export type {
	BranchStatus,
	StoryboardBranch,
	BranchListResponse,
	BranchContext,
	DiffPanelView,
	DiffEntryKind,
	DiffEntry,
	BranchDiffResponse,
	MergeResolution,
	FieldResolution,
	MergeResolutionInput,
	BranchMergeRequest,
	BranchMergeResponse,
	SiblingMergeRequest,
	SiblingMergeResponse
} from './api.js';

// Studio: Curricula + lessons — REMOVED (collapsed into projects with
// parent_project_id recursion; see Studio v2 BE-1 + FE-A foundation plans).

// Studio: Annotations (Studio v2 BE-2)
export type {
	AnnotationStatus,
	AnnotationResponse,
	AnnotationListResponse,
	CreateAnnotationRequest,
	UpdateAnnotationRequest
} from './annotations.js';
