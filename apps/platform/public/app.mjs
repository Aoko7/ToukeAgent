import { createApprovalInspectorController } from './approval-inspector-controller.mjs';
import { createCompareReviewerRenderers } from './compare-reviewer-renderers.mjs';
import { createCandidateSuiteRenderers } from './candidate-suite-renderers.mjs';
import { createConsoleShellController } from './console-shell-controller.mjs';
import { createDeadLetterInspectorController } from './dead-letter-inspector-controller.mjs';
import { createDeliveryInspectorController } from './delivery-inspector-controller.mjs';
import { createGovernanceInspectorController } from './governance-inspector-controller.mjs';
import { createHarnessDetailRenderers } from './harness-detail-renderers.mjs';
import { createHarnessInspectorController } from './harness-inspector-controller.mjs';
import { createInspectorShellController } from './inspector-shell-controller.mjs';
import { createKnowledgeInspectorController } from './knowledge-inspector-controller.mjs';
import { createMemoryInspectorController } from './memory-inspector-controller.mjs';
import { createModelInspectorController } from './model-inspector-controller.mjs';
import { createQueueInspectorController } from './queue-inspector-controller.mjs';
import { createRecoveryInspectorController } from './recovery-inspector-controller.mjs';
import { createSharedRenderers } from './shared-renderers.mjs';
import { createTaskActionsController } from './task-actions-controller.mjs';
import { createTaskTraceController } from './task-trace-controller.mjs';
import { createToolsInspectorController } from './tools-inspector-controller.mjs';
import { createWikiInspectorController } from './wiki-inspector-controller.mjs';

const defaultPersonaOptions = ['researcher', 'retriever', 'reviewer', 'operator', 'planner', 'writer'];
const inspectorViews = [
  ['task', 'Task'],
  ['trace', 'Trace'],
  ['tools', 'Tools'],
  ['harness', 'Harness'],
  ['wiki', 'Wiki'],
  ['model', 'Model'],
  ['deliveries', 'Deliveries'],
  ['queue', 'Queue'],
  ['knowledge', 'Knowledge'],
  ['memory', 'Memory'],
  ['evaluation', 'Eval'],
  ['review', 'Review'],
  ['approval', 'Approval'],
  ['handoffs', 'Handoffs'],
  ['context', 'Budget'],
  ['rl', 'RL'],
  ['governance', 'Gov'],
  ['deadLetters', 'Dead Letters'],
  ['recovery', 'Recovery'],
];

const output = document.getElementById('inspector-output');
const inspectorSummary = document.getElementById('inspector-summary');
const inspectorHint = document.getElementById('inspector-hint');
const inspectorTabs = document.getElementById('inspector-tabs');
const streamTimeline = document.getElementById('stream-timeline');
const streamHint = document.getElementById('stream-hint');
const streamState = document.getElementById('stream-state');
const taskStatus = document.getElementById('task-status');
const personaStatus = document.getElementById('persona-status');
const taskRef = document.getElementById('task-ref');
const taskChips = document.getElementById('task-chips');
const taskMeta = document.getElementById('task-meta');
const recentTaskList = document.getElementById('task-recent-list');
const messageForm = document.getElementById('message-form');
const workspaceIdInput = document.getElementById('workspace-id');
const taskIdInput = document.getElementById('task-id');
const recoveryModeSelect = document.getElementById('recovery-mode');
const personaHidden = document.getElementById('persona-hidden');
const personaSwitcher = document.getElementById('persona-switcher');
const messageInput = document.getElementById('message-content');
const sendButton = document.getElementById('send-message');
const refreshButton = document.getElementById('refresh-task');
const reloadInspectorButton = document.getElementById('reload-inspector');
const exportTraceBundleButton = document.getElementById('export-trace-bundle');
const exportAuditSnapshotButton = document.getElementById('export-audit-snapshot');
const replayButton = document.getElementById('replay-task');
const recoverButton = document.getElementById('recover-task');
const approveButton = document.getElementById('approve-task');
const takeoverButton = document.getElementById('takeover-task');
const loadButton = document.getElementById('load-task');
const disconnectButton = document.getElementById('disconnect-task');
const wikiStatus = document.getElementById('wiki-status');
const wikiEntryIdInput = document.getElementById('wiki-entry-id');
const wikiProposalIdInput = document.getElementById('wiki-proposal-id');
const wikiBaseVersionInput = document.getElementById('wiki-base-version');
const wikiTargetVersionInput = document.getElementById('wiki-target-version');
const wikiReviewerIdInput = document.getElementById('wiki-reviewer-id');
const wikiMergeStrategySelect = document.getElementById('wiki-merge-strategy');
const wikiTitleInput = document.getElementById('wiki-title');
const wikiSummaryInput = document.getElementById('wiki-summary');
const wikiFactsInput = document.getElementById('wiki-facts');
const wikiTagsInput = document.getElementById('wiki-tags');
const wikiQueryInput = document.getElementById('wiki-query');
const wikiMarkdownInput = document.getElementById('wiki-markdown-input');
const wikiRefreshButton = document.getElementById('refresh-wiki');
const wikiLoadEntryButton = document.getElementById('load-wiki-entry');
const wikiLoadProposalButton = document.getElementById('load-wiki-proposal');
const wikiSubmitProposalButton = document.getElementById('submit-wiki-proposal');
const wikiImportMarkdownButton = document.getElementById('import-wiki-markdown');
const wikiApproveProposalButton = document.getElementById('approve-wiki-proposal');
const wikiRejectProposalButton = document.getElementById('reject-wiki-proposal');
const wikiRollbackButton = document.getElementById('rollback-wiki-entry');
const wikiRefreshHistoryButton = document.getElementById('refresh-wiki-history');
const wikiSummaryChips = document.getElementById('wiki-summary-chips');
const wikiEntryList = document.getElementById('wiki-entry-list');
const wikiProposalList = document.getElementById('wiki-proposal-list');
const wikiHistoryList = document.getElementById('wiki-history-list');
const wikiOutput = document.getElementById('wiki-output');
const harnessOps = document.getElementById('harness-ops');
const harnessTypeFilter = document.getElementById('harness-type-filter');
const harnessSelectedId = document.getElementById('harness-selected-id');
const harnessRefreshButton = document.getElementById('refresh-harness');
const runMemoryHarnessButton = document.getElementById('run-memory-harness');
const runWikiHarnessButton = document.getElementById('run-wiki-harness');
const runKnowledgeHarnessButton = document.getElementById('run-knowledge-harness');
const draftMemoryHarnessButton = document.getElementById('draft-memory-harness');
const draftWikiHarnessButton = document.getElementById('draft-wiki-harness');
const downloadMemoryDraftButton = document.getElementById('download-memory-draft');
const downloadWikiDraftButton = document.getElementById('download-wiki-draft');
const saveMemoryDraftCaseButton = document.getElementById('save-memory-draft-case');
const saveWikiDraftCaseButton = document.getElementById('save-wiki-draft-case');
const promoteMemoryDraftCaseButton = document.getElementById('promote-memory-draft-case');
const promoteWikiDraftCaseButton = document.getElementById('promote-wiki-draft-case');
const refreshMemoryCandidateSuitesButton = document.getElementById('refresh-memory-candidate-suites');
const runMemoryCandidateSuiteButton = document.getElementById('run-memory-candidate-suite');
const refreshWikiCandidateSuitesButton = document.getElementById('refresh-wiki-candidate-suites');
const runWikiCandidateSuiteButton = document.getElementById('run-wiki-candidate-suite');
const approveMemoryCandidateCaseButton = document.getElementById('approve-memory-candidate-case');
const batchReviewMemoryCandidateCasesButton = document.getElementById('batch-review-memory-candidate-cases');
const approveWikiCandidateCaseButton = document.getElementById('approve-wiki-candidate-case');
const batchReviewWikiCandidateCasesButton = document.getElementById('batch-review-wiki-candidate-cases');
const compareWikiCandidateCaseButton = document.getElementById('compare-wiki-candidate-case');
const compareWikiCandidateSuiteButton = document.getElementById('compare-wiki-candidate-suite');
const compareMemoryCandidateCaseButton = document.getElementById('compare-memory-candidate-case');
const compareMemoryCandidateSuiteButton = document.getElementById('compare-memory-candidate-suite');
const promoteMemoryCandidateCaseGoldButton = document.getElementById('promote-memory-candidate-case-gold');
const rollbackMemoryGoldCaseButton = document.getElementById('rollback-memory-gold-case');
const batchRollbackMemoryGoldCasesButton = document.getElementById('batch-rollback-memory-gold-cases');
const loadMemoryGoldHistoryButton = document.getElementById('load-memory-gold-history');
const memoryCandidateReviewDecision = document.getElementById('memory-candidate-review-decision');
const memoryCandidateReviewerId = document.getElementById('memory-candidate-reviewer-id');
const memoryCandidateReviewNotes = document.getElementById('memory-candidate-review-notes');
const wikiCandidateReviewDecision = document.getElementById('wiki-candidate-review-decision');
const wikiCandidateReviewerId = document.getElementById('wiki-candidate-reviewer-id');
const wikiCandidateReviewNotes = document.getElementById('wiki-candidate-review-notes');
const harnessSummaryChips = document.getElementById('harness-summary-chips');
const harnessRunList = document.getElementById('harness-run-list');
const harnessDraftCaseList = document.getElementById('harness-draft-case-list');
const harnessCandidateSuiteList = document.getElementById('harness-candidate-suite-list');
const harnessDetailOutput = document.getElementById('harness-detail-output');
const deliveryOps = document.getElementById('delivery-ops');
const deliveryPlatformFilter = document.getElementById('delivery-platform-filter');
const deliveryStatusFilter = document.getElementById('delivery-status-filter');
const deliverySortOrder = document.getElementById('delivery-sort-order');
const deliverySelectedId = document.getElementById('delivery-selected-id');
const deliveryRefreshButton = document.getElementById('refresh-deliveries');
const deliveryClearFiltersButton = document.getElementById('clear-delivery-filters');
const deliverySummaryChips = document.getElementById('delivery-summary-chips');
const deliveryList = document.getElementById('delivery-list');
const deliveryReceiptList = document.getElementById('delivery-receipt-list');
const deliveryDetailOutput = document.getElementById('delivery-detail-output');
const queueOps = document.getElementById('queue-ops');
const queueTaskFilter = document.getElementById('queue-task-filter');
const queueTraceFilter = document.getElementById('queue-trace-filter');
const queueWorkerFilter = document.getElementById('queue-worker-filter');
const queueStatusFilter = document.getElementById('queue-status-filter');
const queueSelectedId = document.getElementById('queue-selected-id');
const queueRefreshButton = document.getElementById('refresh-queue');
const queueRequeueStaleButton = document.getElementById('requeue-stale-jobs');
const inspectQueueDeadLettersButton = document.getElementById('inspect-queue-dead-letters');
const inspectQueueRecoveryButton = document.getElementById('inspect-queue-recovery');
const inspectQueueGovernanceButton = document.getElementById('inspect-queue-governance');
const queueClearFiltersButton = document.getElementById('clear-queue-filters');
const queueSummaryChips = document.getElementById('queue-summary-chips');
const queueJobList = document.getElementById('queue-job-list');
const queueDetailOutput = document.getElementById('queue-detail-output');
const modelOps = document.getElementById('model-ops');
const modelSummaryChips = document.getElementById('model-summary-chips');
const modelProviderList = document.getElementById('model-provider-list');
const modelFallbackList = document.getElementById('model-fallback-list');
const modelDetailOutput = document.getElementById('model-detail-output');
const knowledgeOps = document.getElementById('knowledge-ops');
const knowledgeQueryInput = document.getElementById('knowledge-query');
const knowledgeSelectedStage = document.getElementById('knowledge-selected-stage');
const knowledgeSummaryChips = document.getElementById('knowledge-summary-chips');
const knowledgeStageList = document.getElementById('knowledge-stage-list');
const knowledgeDetailOutput = document.getElementById('knowledge-detail-output');
const memoryOps = document.getElementById('memory-ops');
const memorySummaryChips = document.getElementById('memory-summary-chips');
const memoryDetailOutput = document.getElementById('memory-detail-output');
const toolsOps = document.getElementById('tools-ops');
const toolsSummaryChips = document.getElementById('tools-summary-chips');
const toolsDetailOutput = document.getElementById('tools-detail-output');
const governanceOps = document.getElementById('governance-ops');
const governanceSummaryChips = document.getElementById('governance-summary-chips');
const governanceDetailOutput = document.getElementById('governance-detail-output');
const approvalOps = document.getElementById('approval-ops');
const approvalSelectedId = document.getElementById('approval-selected-id');
const approvalSummaryChips = document.getElementById('approval-summary-chips');
const approvalList = document.getElementById('approval-list');
const approvalChangeList = document.getElementById('approval-change-list');
const approvalDetailOutput = document.getElementById('approval-detail-output');
const deadLetterOps = document.getElementById('dead-letter-ops');
const deadLetterStatusFilter = document.getElementById('dead-letter-status-filter');
const deadLetterReplayableFilter = document.getElementById('dead-letter-replayable-filter');
const deadLetterSelectedId = document.getElementById('dead-letter-selected-id');
const refreshDeadLettersButton = document.getElementById('refresh-dead-letters');
const replayDeadLetterButton = document.getElementById('replay-dead-letter');
const recoverDeadLetterTaskButton = document.getElementById('recover-dead-letter-task');
const deadLetterSummaryChips = document.getElementById('dead-letter-summary-chips');
const deadLetterList = document.getElementById('dead-letter-list');
const deadLetterDetailOutput = document.getElementById('dead-letter-detail-output');
const recoveryOps = document.getElementById('recovery-ops');
const recoveryStatusFilter = document.getElementById('recovery-status-filter');
const recoverySelectedId = document.getElementById('recovery-selected-id');
const refreshRecoveryDrillsButton = document.getElementById('refresh-recovery-drills');
const recoverySummaryChips = document.getElementById('recovery-summary-chips');
const recoveryList = document.getElementById('recovery-list');
const recoveryDetailOutput = document.getElementById('recovery-detail-output');

const storageKey = 'toukeagent.console.recentTasks';

const state = {
  taskId: taskIdInput.value.trim(),
  personaHint: personaHidden.value || defaultPersonaOptions[0],
  activeInspector: 'task',
  lastSeq: 0,
  streamEvents: [],
  currentTask: null,
  currentBundle: null,
  currentInspector: null,
  queueSelectedJobId: null,
  queueFilterPrimed: false,
  source: null,
  reconnectTimer: null,
  manualDisconnect: false,
  recentTasks: [],
  approvalItems: [],
  approvalSelectedId: null,
  wikiEntries: [],
  wikiProposals: [],
  wikiHistory: [],
  wikiCurrentEntry: null,
  wikiCurrentProposal: null,
  wikiProviderStrategy: null,
  wikiRuntimeSummary: null,
  harnessRuns: [],
  harnessSelectedId: null,
  harnessSelectedCaseId: null,
  memoryHarnessDraft: null,
  memoryHarnessDraftSelectedCaseId: null,
  wikiHarnessDraft: null,
  wikiHarnessDraftSelectedCaseId: null,
  memoryCandidateSuites: [],
  memoryCandidateSuiteSelectedPath: null,
  memoryCandidateSuiteSelectedCaseId: null,
  memoryCandidateSuiteSelectedCaseIds: [],
  wikiCandidateSuites: [],
  wikiCandidateSuiteSelectedPath: null,
  wikiCandidateSuiteSelectedCaseId: null,
  wikiCandidateSuiteSelectedCaseIds: [],
  deliveryItems: [],
  deliveryReceipts: [],
  deliverySelectedId: null,
  deliverySelectedReceiptId: null,
  knowledgeSelectedStageId: null,
  personaCatalog: null,
  deadLetterItems: [],
  deadLetterSelectedId: null,
  recoveryItems: [],
  recoverySelectedId: null,
};

function clearNode(node) {
  node.replaceChildren();
}

function createChip(text, tone = null) {
  const chip = document.createElement('span');
  chip.className = 'chip';
  if (tone) {
    chip.dataset.tone = tone;
  }
  chip.textContent = text;
  return chip;
}

function setStatus(node, text, tone = 'warn') {
  node.textContent = text;
  node.dataset.tone = tone;
}

const {
  renderValueSummary,
  appendDraftKv,
  appendDraftListSection,
  appendDraftJsonSection,
  renderKnowledgeFrontendDetail,
  appendDraftTableSection,
  createCompareValue,
  appendCompareChecklistSection,
  appendCompareFieldSummarySection,
  appendCompareFieldDiffGroup,
  appendSuiteComparisonSection,
  appendWikiSuiteComparisonSection,
  renderTextDetail,
} = createSharedRenderers({
  clearNode,
  createChip,
  knowledgeDetailOutput,
});

const {
  renderComparisonDetail,
  createMemoryCompareRenderConfig,
  createWikiCompareRenderConfig,
  appendMemoryComparisonReviewerSummary,
  appendMemoryComparisonGapSection,
  appendMemoryCaseComparisonReviewerDetail,
  appendWikiComparisonReviewerSummary,
  appendWikiComparisonGapSection,
  appendWikiCaseComparisonReviewerDetail,
  renderMemoryCandidateComparisonDetail,
  renderWikiCandidateComparisonDetail,
} = createCompareReviewerRenderers({
  harnessDetailOutput,
  clearNode,
  appendDraftJsonSection,
  appendCompareChecklistSection,
  appendCompareFieldSummarySection,
  appendCompareFieldDiffGroup,
  appendDraftListSection,
  appendDraftKv,
  createChip,
  createCompareValue,
  appendSuiteComparisonSection,
  appendWikiSuiteComparisonSection,
});

function toggleSelectedMemoryCandidateCase(caseId, selected) {
  const next = new Set(state.memoryCandidateSuiteSelectedCaseIds ?? []);
  if (selected) {
    next.add(caseId);
  } else {
    next.delete(caseId);
  }
  state.memoryCandidateSuiteSelectedCaseIds = Array.from(next);
}

function toggleSelectedWikiCandidateCase(caseId, selected) {
  const next = new Set(state.wikiCandidateSuiteSelectedCaseIds ?? []);
  if (selected) {
    next.add(caseId);
  } else {
    next.delete(caseId);
  }
  state.wikiCandidateSuiteSelectedCaseIds = Array.from(next);
}

function renderMemoryCandidateReviewFormState(selectedCase) {
  if (memoryCandidateReviewDecision && selectedCase?.metadata?.review_status) {
    memoryCandidateReviewDecision.value = selectedCase.metadata.review_status;
  }
  if (memoryCandidateReviewerId && selectedCase?.metadata?.reviewer_id) {
    memoryCandidateReviewerId.value = selectedCase.metadata.reviewer_id;
  }
  if (memoryCandidateReviewNotes) {
    memoryCandidateReviewNotes.value = selectedCase?.metadata?.review_notes ?? 'Reviewed from candidate suite console flow';
  }
}

function renderWikiCandidateReviewFormState(selectedCase) {
  if (wikiCandidateReviewDecision && selectedCase?.metadata?.review_status) {
    wikiCandidateReviewDecision.value = selectedCase.metadata.review_status;
  }
  if (wikiCandidateReviewerId && selectedCase?.metadata?.reviewer_id) {
    wikiCandidateReviewerId.value = selectedCase.metadata.reviewer_id;
  }
  if (wikiCandidateReviewNotes) {
    wikiCandidateReviewNotes.value = selectedCase?.metadata?.review_notes ?? 'Reviewed from wiki candidate suite console flow';
  }
}

const {
  buildMemoryCandidateSuiteStats,
  buildWikiCandidateSuiteStats,
  renderMemoryGoldHistoryAudit,
  renderMemoryCandidateSuiteDetail,
  renderMemoryCandidateSuites,
  renderWikiCandidateSuiteDetail,
  renderWikiCandidateSuites,
} = createCandidateSuiteRenderers({
  state,
  harnessDetailOutput,
  harnessCandidateSuiteList,
  clearNode,
  appendDraftJsonSection,
  appendDraftListSection,
  appendDraftKv,
  createChip,
  createCompareValue,
  formatTimestamp,
  toggleSelectedMemoryCandidateCase,
  toggleSelectedWikiCandidateCase,
  fetchJson,
  renderMemoryCandidateReviewFormState,
  renderWikiCandidateReviewFormState,
});

const {
  getHarnessCaseTone,
  buildHarnessCaseSubtitle,
  renderHarnessRunReviewerDetail,
  renderMemoryHarnessDraftDetail,
  renderMemoryHarnessDraft,
  renderWikiHarnessDraft,
  renderWikiHarnessDraftDetail,
} = createHarnessDetailRenderers({
  state,
  harnessDetailOutput,
  harnessSummaryChips,
  harnessDraftCaseList,
  clearNode,
  appendDraftJsonSection,
  appendDraftListSection,
  appendDraftKv,
  appendDraftTableSection,
  createChip,
  renderTextDetail,
});

const {
  bindHarnessInspectorEvents,
  buildHarnessRunsEndpoint,
  normalizeHarnessInspectorPayload,
  buildHarnessInspectorSummary,
  loadHarnessInspectorData,
  clearHarnessInspector,
  setHarnessInspectorVisibility,
  renderHarnessInspectorPanel,
  renderHarnessInspector,
  runDefaultMemoryHarnessSuite,
  runDefaultWikiHarnessSuite,
  runDefaultKnowledgeHarnessSuite,
  draftMemoryHarnessFromCurrentTask,
  draftWikiHarnessFromCurrentTask,
  downloadCurrentMemoryDraft,
  downloadCurrentWikiDraft,
  saveSelectedMemoryDraftCase,
  saveSelectedWikiDraftCase,
  promoteSelectedMemoryDraftCase,
  promoteSelectedWikiDraftCase,
  refreshMemoryCandidateSuites,
  refreshWikiCandidateSuites,
  runSelectedMemoryCandidateSuite,
  runSelectedWikiCandidateSuite,
  approveSelectedWikiCandidateCase,
  batchReviewSelectedWikiCandidateCases,
  compareSelectedWikiCandidateCase,
  compareSelectedWikiCandidateSuite,
  approveSelectedMemoryCandidateCase,
  batchReviewSelectedMemoryCandidateCases,
  promoteSelectedMemoryCandidateCaseToGold,
  compareSelectedMemoryCandidateCase,
  compareSelectedMemoryCandidateSuite,
  loadSelectedMemoryGoldHistory,
  rollbackSelectedMemoryGoldPromotion,
  batchRollbackSelectedMemoryGoldPromotions,
} = createHarnessInspectorController({
  state,
  harnessSelectedId,
  harnessSummaryChips,
  harnessRunList,
  harnessDraftCaseList,
  harnessCandidateSuiteList,
  harnessTypeFilter,
  harnessDetailOutput,
  taskStatus,
  clearNode,
  createChip,
  setStatus,
  fetchJson,
  formatTimestamp,
  normalizeTaskId,
  triggerDownload,
  renderInspectorTabs,
  loadInspector,
  renderTextDetail,
  renderHarnessRunReviewerDetail,
  buildHarnessCaseSubtitle,
  renderMemoryHarnessDraft,
  renderWikiHarnessDraft,
  renderMemoryCandidateSuites,
  renderWikiCandidateSuites,
  renderMemoryCandidateComparisonDetail,
  renderWikiCandidateComparisonDetail,
  renderMemoryGoldHistoryAudit,
  appendDraftJsonSection,
  memoryCandidateReviewDecision,
  memoryCandidateReviewerId,
  memoryCandidateReviewNotes,
  wikiCandidateReviewDecision,
  wikiCandidateReviewerId,
  wikiCandidateReviewNotes,
  controls: {
    harnessOps,
    harnessRefreshButton,
    runMemoryHarnessButton,
    runWikiHarnessButton,
    runKnowledgeHarnessButton,
    draftMemoryHarnessButton,
    draftWikiHarnessButton,
    downloadMemoryDraftButton,
    downloadWikiDraftButton,
    saveMemoryDraftCaseButton,
    saveWikiDraftCaseButton,
    promoteMemoryDraftCaseButton,
    promoteWikiDraftCaseButton,
    refreshMemoryCandidateSuitesButton,
    runMemoryCandidateSuiteButton,
    refreshWikiCandidateSuitesButton,
    runWikiCandidateSuiteButton,
    approveMemoryCandidateCaseButton,
    batchReviewMemoryCandidateCasesButton,
    approveWikiCandidateCaseButton,
    batchReviewWikiCandidateCasesButton,
    compareWikiCandidateCaseButton,
    compareWikiCandidateSuiteButton,
    compareMemoryCandidateCaseButton,
    compareMemoryCandidateSuiteButton,
    promoteMemoryCandidateCaseGoldButton,
    rollbackMemoryGoldCaseButton,
    batchRollbackMemoryGoldCasesButton,
    loadMemoryGoldHistoryButton,
  },
});

const {
  bindDeliveryInspectorEvents,
  compareDeliveryItems,
  buildDeliveryInspectorSummary,
  normalizeDeliveryInspectorPayload,
  buildDeliveriesEndpoint,
  loadDeliveryInspectorData,
  clearDeliveryInspector,
  setDeliveryInspectorVisibility,
  renderDeliveryInspectorPanel,
  renderDeliveryInspector,
} = createDeliveryInspectorController({
  state,
  deliveryOps,
  deliveryPlatformFilter,
  deliveryStatusFilter,
  deliverySortOrder,
  deliverySelectedId,
  deliverySummaryChips,
  deliveryList,
  deliveryReceiptList,
  deliveryDetailOutput,
  clearNode,
  createChip,
  formatTimestamp,
  fetchJson,
  loadInspector,
  syncSelectOptions,
  controls: {
    deliveryRefreshButton,
    deliveryClearFiltersButton,
  },
});

const {
  bindQueueInspectorEvents,
  buildQueueQueryParams,
  buildQueueEndpoint,
  getSelectedQueueJob,
  normalizeQueueInspectorPayload,
  buildQueueInspectorSummary,
  loadQueueInspectorData,
  clearQueueInspector,
  setQueueInspectorVisibility,
  renderQueueInspectorPanel,
  renderQueueInspector,
  inspectSelectedQueueTask,
  requeueStaleJobs,
  clearQueueFilters,
} = createQueueInspectorController({
  state,
  taskIdInput,
  queueOps,
  queueTaskFilter,
  queueTraceFilter,
  queueWorkerFilter,
  queueStatusFilter,
  queueSelectedId,
  queueSummaryChips,
  queueJobList,
  queueDetailOutput,
  taskStatus,
  clearNode,
  createChip,
  formatTimestamp,
  fetchJson,
  loadInspector,
  renderInspectorTabs,
  renderTextDetail,
  setStatus,
  normalizeTaskId,
  syncSelectOptions,
  controls: {
    queueRefreshButton,
    queueRequeueStaleButton,
    inspectQueueDeadLettersButton,
    inspectQueueRecoveryButton,
    inspectQueueGovernanceButton,
    queueClearFiltersButton,
  },
});

const {
  normalizeModelInspectorPayload,
  buildModelInspectorSummary,
  clearModelInspector,
  setModelInspectorVisibility,
  renderModelInspectorPanel,
} = createModelInspectorController({
  modelOps,
  modelSummaryChips,
  modelProviderList,
  modelFallbackList,
  modelDetailOutput,
  clearNode,
  createChip,
});

const {
  normalizeToolsInspectorPayload,
  buildToolsInspectorSummary,
  clearToolsInspector,
  setToolsInspectorVisibility,
  renderToolsInspectorPanel,
} = createToolsInspectorController({
  state,
  toolsOps,
  toolsSummaryChips,
  toolsDetailOutput,
  clearNode,
  createChip,
});

const {
  normalizeApprovalInspectorPayload,
  buildApprovalInspectorSummary,
  clearApprovalInspector,
  setApprovalInspectorVisibility,
  renderApprovalInspectorPanel,
} = createApprovalInspectorController({
  state,
  approvalOps,
  approvalSelectedId,
  approvalSummaryChips,
  approvalList,
  approvalChangeList,
  approvalDetailOutput,
  clearNode,
  createChip,
});

const {
  normalizeKnowledgeInspectorPayload,
  buildKnowledgeInspectorSummary,
  clearKnowledgeInspector,
  setKnowledgeInspectorVisibility,
  renderKnowledgeInspectorPanel,
} = createKnowledgeInspectorController({
  state,
  knowledgeOps,
  knowledgeQueryInput,
  knowledgeSelectedStage,
  knowledgeSummaryChips,
  knowledgeStageList,
  knowledgeDetailOutput,
  clearNode,
  createChip,
  renderKnowledgeFrontendDetail,
  renderTextDetail,
});

const {
  normalizeMemoryInspectorPayload,
  buildMemoryInspectorSummary,
  clearMemoryInspector,
  setMemoryInspectorVisibility,
  renderMemoryInspectorPanel,
} = createMemoryInspectorController({
  memoryOps,
  memorySummaryChips,
  memoryDetailOutput,
  clearNode,
  createChip,
  appendDraftJsonSection,
  appendDraftKv,
  appendDraftTableSection,
});

const {
  bindDeadLetterInspectorEvents,
  normalizeDeadLetterInspectorPayload,
  buildDeadLetterInspectorSummary,
  buildDeadLettersEndpoint,
  loadDeadLetterInspectorData,
  clearDeadLetterInspector,
  setDeadLetterInspectorVisibility,
  renderDeadLetterInspectorPanel,
} = createDeadLetterInspectorController({
  state,
  taskIdInput,
  recoveryModeSelect,
  deadLetterOps,
  deadLetterStatusFilter,
  deadLetterReplayableFilter,
  deadLetterSelectedId,
  deadLetterSummaryChips,
  deadLetterList,
  deadLetterDetailOutput,
  taskStatus,
  clearNode,
  createChip,
  appendDraftJsonSection,
  appendDraftKv,
  formatTimestamp,
  fetchJson,
  loadInspector,
  renderInspectorTabs,
  setStatus,
  normalizeTaskId,
  syncSelectOptions,
  hydrateTask,
  controls: {
    refreshDeadLettersButton,
    replayDeadLetterButton,
    recoverDeadLetterTaskButton,
  },
});

const {
  normalizeGovernanceInspectorPayload,
  buildGovernanceInspectorSummary,
  clearGovernanceInspector,
  setGovernanceInspectorVisibility,
  renderGovernanceInspectorPanel,
} = createGovernanceInspectorController({
  governanceOps,
  governanceSummaryChips,
  governanceDetailOutput,
  clearNode,
  createChip,
  appendDraftJsonSection,
  appendDraftKv,
  appendDraftListSection,
  appendDraftTableSection,
});

const {
  bindRecoveryInspectorEvents,
  normalizeRecoveryInspectorPayload,
  buildRecoveryInspectorSummary,
  buildRecoveryEndpoint,
  loadRecoveryInspectorData,
  clearRecoveryInspector,
  setRecoveryInspectorVisibility,
  renderRecoveryInspectorPanel,
} = createRecoveryInspectorController({
  state,
  recoveryOps,
  recoveryStatusFilter,
  recoverySelectedId,
  recoverySummaryChips,
  recoveryList,
  recoveryDetailOutput,
  taskStatus,
  clearNode,
  createChip,
  appendDraftJsonSection,
  appendDraftKv,
  formatTimestamp,
  fetchJson,
  loadInspector,
  renderInspectorTabs,
  setStatus,
  normalizeTaskId,
  syncSelectOptions,
  controls: {
    refreshRecoveryDrillsButton,
  },
});

function setInspectorSummary(items = []) {
  clearNode(inspectorSummary);
  for (const item of items) {
    inspectorSummary.appendChild(createChip(item));
  }
}

function formatTimestamp(value) {
  if (!value) {
    return 'n/a';
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? String(value) : timestamp.toLocaleString();
}

function syncSelectOptions(select, values, { baseValue = 'all', baseLabel = 'all' } = {}) {
  const normalizedValues = Array.from(new Set((values ?? []).filter(Boolean).map((value) => String(value))));
  const currentValue = select.value || baseValue;
  if (currentValue !== baseValue && !normalizedValues.includes(currentValue)) {
    normalizedValues.unshift(currentValue);
  }
  clearNode(select);

  const baseOption = document.createElement('option');
  baseOption.value = baseValue;
  baseOption.textContent = baseLabel;
  select.appendChild(baseOption);

  for (const value of normalizedValues) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }

  select.value = normalizedValues.includes(currentValue) || currentValue === baseValue
    ? currentValue
    : baseValue;
}

const {
  loadRecentTasks,
  saveRecentTasks,
  rememberTask,
  renderPersonaSwitcher,
  setPersona,
  loadPersonaCatalog,
  renderInspectorTabs,
  renderRecentTasks,
  bindConsoleShellEvents,
  bootstrapConsoleShell,
} = createConsoleShellController({
  state,
  storageKey,
  personaHidden,
  personaStatus,
  personaSwitcher,
  inspectorTabs,
  recentTaskList,
  taskIdInput,
  clearNode,
  fetchJson,
  defaultPersonaOptions,
  inspectorViews,
  controls: {
    messageForm,
    refreshButton,
    reloadInspectorButton,
    exportTraceBundleButton,
    exportAuditSnapshotButton,
    replayButton,
    recoverButton,
    approveButton,
    takeoverButton,
    loadButton,
    disconnectButton,
  },
  actions: {
    loadWikiCatalog: (...args) => loadWikiCatalog(...args),
    loadInspector: (...args) => loadInspector(...args),
    hydrateTask: (...args) => hydrateTask(...args),
    sendMessage: (...args) => taskActionsController.sendMessage(...args),
    recoverCurrentTask: (...args) => taskActionsController.recoverCurrentTask(...args),
    approveCurrentTask: (...args) => taskActionsController.approveCurrentTask(...args),
    takeoverCurrentTask: (...args) => taskActionsController.takeoverCurrentTask(...args),
    reloadCurrentTask: (...args) => reloadCurrentTask(...args),
    exportTraceBundleCurrentTask: (...args) => exportTraceBundleCurrentTask(...args),
    exportAuditSnapshotCurrentTask: (...args) => exportAuditSnapshotCurrentTask(...args),
    replayCurrentTask: (...args) => replayCurrentTask(...args),
    loadCurrentTask: (...args) => loadCurrentTask(...args),
    disconnectStream: (...args) => disconnectStream(...args),
    bindWikiInspectorEvents: (...args) => bindWikiInspectorEvents(...args),
    bindHarnessInspectorEvents: (...args) => bindHarnessInspectorEvents(...args),
    bindDeliveryInspectorEvents: (...args) => bindDeliveryInspectorEvents(...args),
    bindQueueInspectorEvents: (...args) => bindQueueInspectorEvents(...args),
    bindDeadLetterInspectorEvents: (...args) => bindDeadLetterInspectorEvents(...args),
    bindRecoveryInspectorEvents: (...args) => bindRecoveryInspectorEvents(...args),
    normalizeTaskId,
    setTaskStatus: (text, tone) => setStatus(taskStatus, text, tone),
    setStreamStatus: (text, tone) => setStatus(streamState, text, tone),
    setWikiStatus: (...args) => setWikiStatus(...args),
    renderWikiLists: (...args) => renderWikiLists(...args),
  },
});

let inspectorShellController = null;

const {
  renderTimeline,
  renderTaskSummary,
  hydrateTask,
  disconnectStream,
  connectStream,
  reloadCurrentTask,
  replayCurrentTask,
  triggerDownload,
  exportTraceBundleCurrentTask,
  exportAuditSnapshotCurrentTask,
  loadCurrentTask,
} = createTaskTraceController({
  state,
  taskIdInput,
  streamTimeline,
  streamHint,
  streamState,
  taskStatus,
  taskRef,
  taskChips,
  taskMeta,
  output,
  inspectorHint,
  clearNode,
  createChip,
  setStatus,
  fetchJson,
  loadInspector,
  rememberTask,
  renderInspectorTabs,
  setInspectorSummary,
  toneForTaskStatus,
});

function renderInspectorData(view, payload) {
  inspectorShellController.renderInspectorData(view, payload);
}

function renderSpecializedInspectorPanels(view, payload) {
  inspectorShellController.renderSpecializedInspectorPanels(view, payload);
}

function normalizeInspectorPayload(view, payload) {
  return inspectorShellController.normalizeInspectorPayload(view, payload);
}

function splitWikiLines(text) {
  return String(text ?? '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitWikiCsv(text) {
  return String(text ?? '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const {
  setWikiStatus,
  renderWikiLists,
  applyWikiEntry,
  applyWikiProposal,
  loadWikiCatalog,
  loadWikiEntry,
  loadWikiProposal,
  refreshWikiHistory,
  submitWikiProposal,
  importWikiMarkdown,
  reviewWikiProposal,
  rollbackWikiEntry,
  bindWikiInspectorEvents,
} = createWikiInspectorController({
  state,
  wikiStatus,
  wikiEntryIdInput,
  wikiProposalIdInput,
  wikiBaseVersionInput,
  wikiTargetVersionInput,
  wikiReviewerIdInput,
  wikiMergeStrategySelect,
  wikiTitleInput,
  wikiSummaryInput,
  wikiFactsInput,
  wikiTagsInput,
  wikiQueryInput,
  wikiMarkdownInput,
  wikiSummaryChips,
  wikiEntryList,
  wikiProposalList,
  wikiHistoryList,
  wikiOutput,
  clearNode,
  createChip,
  setStatus,
  splitWikiLines,
  splitWikiCsv,
  fetchJson,
  renderInspectorData,
  controls: {
    wikiRefreshButton,
    wikiLoadEntryButton,
    wikiLoadProposalButton,
    wikiSubmitProposalButton,
    wikiImportMarkdownButton,
    wikiApproveProposalButton,
    wikiRejectProposalButton,
    wikiRollbackButton,
    wikiRefreshHistoryButton,
  },
});

function toneForTaskStatus(status) {
  if (!status) return 'warn';
  if (['completed', 'passed', 'ok'].includes(status)) return 'good';
  if (['waiting_approval', 'review_required', 'blocked', 'dead_letter', 'failed'].includes(status)) return 'bad';
  return 'warn';
}

function normalizeTaskId() {
  const value = taskIdInput.value.trim();
  state.taskId = value;
  return value;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && payload.error ? payload.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function loadInspector(view = state.activeInspector, taskId = state.taskId) {
  await inspectorShellController.loadInspector(view, taskId);
}

const taskActionsController = createTaskActionsController({
  state,
  workspaceIdInput,
  taskIdInput,
  recoveryModeSelect,
  messageInput,
  sendButton,
  taskStatus,
  fetchJson,
  hydrateTask,
  rememberTask,
  renderInspectorTabs,
  loadInspector,
  setStatus,
  normalizeTaskId,
});

inspectorShellController = createInspectorShellController({
  state,
  output,
  inspectorSummary,
  inspectorHint,
  clearNode,
  createChip,
  fetchJson,
  renderInspectorTabs,
  buildHarnessRunsEndpoint,
  buildDeliveriesEndpoint,
  buildQueueEndpoint,
  buildDeadLettersEndpoint,
  buildRecoveryEndpoint,
  loadHarnessInspectorData,
  loadDeliveryInspectorData,
  loadQueueInspectorData,
  loadDeadLetterInspectorData,
  loadRecoveryInspectorData,
  normalizeToolsInspectorPayload,
  normalizeHarnessInspectorPayload,
  normalizeModelInspectorPayload,
  normalizeKnowledgeInspectorPayload,
  normalizeMemoryInspectorPayload,
  normalizeDeliveryInspectorPayload,
  normalizeQueueInspectorPayload,
  normalizeApprovalInspectorPayload,
  normalizeGovernanceInspectorPayload,
  normalizeDeadLetterInspectorPayload,
  normalizeRecoveryInspectorPayload,
  buildToolsInspectorSummary,
  buildHarnessInspectorSummary,
  buildModelInspectorSummary,
  buildKnowledgeInspectorSummary,
  buildMemoryInspectorSummary,
  buildDeliveryInspectorSummary,
  buildQueueInspectorSummary,
  buildApprovalInspectorSummary,
  buildGovernanceInspectorSummary,
  buildDeadLetterInspectorSummary,
  buildRecoveryInspectorSummary,
  setHarnessInspectorVisibility,
  setDeliveryInspectorVisibility,
  setQueueInspectorVisibility,
  setModelInspectorVisibility,
  setKnowledgeInspectorVisibility,
  setMemoryInspectorVisibility,
  setToolsInspectorVisibility,
  setGovernanceInspectorVisibility,
  setApprovalInspectorVisibility,
  setDeadLetterInspectorVisibility,
  setRecoveryInspectorVisibility,
  renderHarnessInspectorPanel,
  renderDeliveryInspectorPanel,
  renderQueueInspectorPanel,
  renderModelInspectorPanel,
  renderKnowledgeInspectorPanel,
  renderMemoryInspectorPanel,
  renderToolsInspectorPanel,
  renderGovernanceInspectorPanel,
  renderApprovalInspectorPanel,
  renderDeadLetterInspectorPanel,
  renderRecoveryInspectorPanel,
});

void bootstrapConsoleShell();
