export function createSharedRenderers({
  clearNode,
  createChip,
  knowledgeDetailOutput,
} = {}) {
  function renderValueSummary(value) {
    if (value === null || value === undefined || value === '') {
      return 'n/a';
    }
    if (typeof value === 'string') {
      return value;
    }
    return JSON.stringify(value);
  }

  function appendDraftKv(container, label, value) {
    const item = document.createElement('div');
    item.className = 'draft-kv';

    const title = document.createElement('strong');
    title.textContent = label;

    const body = document.createElement('span');
    body.textContent = renderValueSummary(value);

    item.append(title, body);
    container.appendChild(item);
  }

  function appendDraftListSection(container, titleText, values) {
    const section = document.createElement('section');
    section.className = 'draft-section';

    const title = document.createElement('strong');
    title.textContent = titleText;
    section.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'draft-list';
    const items = Array.isArray(values) ? values : [];
    if (items.length === 0) {
      const empty = document.createElement('li');
      empty.textContent = 'n/a';
      list.appendChild(empty);
    } else {
      for (const value of items) {
        const li = document.createElement('li');
        li.textContent = renderValueSummary(value);
        list.appendChild(li);
      }
    }
    section.appendChild(list);
    container.appendChild(section);
  }

  function appendDraftJsonSection(container, titleText, value) {
    const section = document.createElement('section');
    section.className = 'draft-section';

    const title = document.createElement('strong');
    title.textContent = titleText;

    const body = document.createElement('pre');
    body.textContent = JSON.stringify(value ?? {}, null, 2);

    section.append(title, body);
    container.appendChild(section);
  }

  function appendDraftTableSection(container, titleText, rows = [], columns = []) {
    const section = document.createElement('section');
    section.className = 'draft-section';

    const title = document.createElement('strong');
    title.textContent = titleText;
    section.appendChild(title);

    if (!Array.isArray(rows) || rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tiny muted';
      empty.textContent = 'n/a';
      section.appendChild(empty);
      container.appendChild(section);
      return;
    }

    const table = document.createElement('table');
    table.className = 'diff-table';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const column of columns) {
      const th = document.createElement('th');
      th.textContent = column.label;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const column of columns) {
        const td = document.createElement('td');
        td.textContent = renderValueSummary(row?.[column.key]);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    section.appendChild(table);
    container.appendChild(section);
  }

  function createCompareValue(labelText, value, { muted = false } = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'compare-value';

    const label = document.createElement('span');
    label.className = 'compare-label';
    label.textContent = labelText;
    wrapper.appendChild(label);

    if (value && typeof value === 'object') {
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(value, null, 2);
      wrapper.appendChild(pre);
      return wrapper;
    }

    const body = document.createElement('span');
    body.className = `compare-inline${muted ? ' muted' : ''}`;
    body.textContent = renderValueSummary(value);
    wrapper.appendChild(body);
    return wrapper;
  }

  function appendCompareChecklistSection(container, checklist = []) {
    const section = document.createElement('section');
    section.className = 'draft-section';

    const title = document.createElement('strong');
    title.textContent = 'Checklist';
    section.appendChild(title);

    const ordered = [...checklist].sort((left, right) => Number(left?.passed) - Number(right?.passed));
    const grid = document.createElement('div');
    grid.className = 'compare-grid';

    for (const item of ordered) {
      const card = document.createElement('div');
      card.className = 'compare-card';
      card.dataset.tone = item?.passed ? 'good' : 'bad';

      const head = document.createElement('div');
      head.className = 'compare-card-head';
      const heading = document.createElement('span');
      heading.className = 'compare-card-title';
      heading.textContent = item?.key ?? 'check';
      head.appendChild(heading);
      head.appendChild(createChip(item?.passed ? 'pass' : 'fail', item?.passed ? 'good' : 'bad'));
      card.appendChild(head);
      card.appendChild(createCompareValue('Detail', item?.detail ?? 'n/a', { muted: !item?.passed }));
      grid.appendChild(card);
    }

    section.appendChild(grid);
    container.appendChild(section);
  }

  function appendCompareFieldSummarySection(container, fieldDiffSummary = {}) {
    const section = document.createElement('section');
    section.className = 'draft-section';

    const title = document.createElement('strong');
    title.textContent = 'Field Diff Summary';
    section.appendChild(title);

    const chips = document.createElement('div');
    chips.className = 'chip-row';
    for (const [group, summary] of Object.entries(fieldDiffSummary ?? {})) {
      chips.appendChild(createChip(
        `${group}:${summary?.different ?? 0}/${summary?.total ?? 0}`,
        (summary?.different ?? 0) > 0 ? 'warn' : 'good',
      ));
    }
    section.appendChild(chips);
    container.appendChild(section);
  }

  function appendCompareFieldDiffGroup(container, fieldGroup, rows = []) {
    const section = document.createElement('section');
    section.className = 'draft-section';

    const title = document.createElement('strong');
    title.textContent = `Field Diff · ${fieldGroup}`;
    section.appendChild(title);

    const ordered = [...rows].sort((left, right) => Number(Boolean(left?.equal)) - Number(Boolean(right?.equal)));
    const grid = document.createElement('div');
    grid.className = 'compare-grid';

    for (const row of ordered) {
      const card = document.createElement('div');
      card.className = 'compare-card';
      card.dataset.tone = row?.equal ? 'good' : 'bad';

      const head = document.createElement('div');
      head.className = 'compare-card-head';
      const heading = document.createElement('span');
      heading.className = 'compare-card-title';
      heading.textContent = row?.path ?? fieldGroup;
      head.appendChild(heading);
      head.appendChild(createChip(row?.equal ? 'equal' : 'diff', row?.equal ? 'good' : 'bad'));
      card.appendChild(head);

      const chips = document.createElement('div');
      chips.className = 'chip-row';
      chips.appendChild(createChip(`type:${row?.type ?? 'n/a'}`));
      if (typeof row?.candidate_count === 'number' || typeof row?.gold_count === 'number') {
        chips.appendChild(createChip(`cand:${row?.candidate_count ?? 0}`));
        chips.appendChild(createChip(`gold:${row?.gold_count ?? 0}`));
      }
      card.appendChild(chips);

      const values = document.createElement('div');
      values.className = 'compare-values';
      values.appendChild(createCompareValue('Candidate', row?.candidate ?? row?.candidate_preview ?? row?.candidate_only ?? null));
      values.appendChild(createCompareValue('Gold', row?.gold ?? row?.gold_preview ?? row?.gold_only ?? null));
      card.appendChild(values);

      if (Array.isArray(row?.overlap) && row.overlap.length > 0) {
        card.appendChild(createCompareValue('Overlap', row.overlap));
      }

      grid.appendChild(card);
    }

    section.appendChild(grid);
    container.appendChild(section);
  }

  function appendSuiteComparisonSection(container, comparisons = []) {
    const section = document.createElement('section');
    section.className = 'draft-section';

    const title = document.createElement('strong');
    title.textContent = 'Suite Compare';
    section.appendChild(title);

    const ordered = [...comparisons].sort((left, right) => {
      const leftFails = left?.checklist?.filter((item) => !item.passed).length ?? 0;
      const rightFails = right?.checklist?.filter((item) => !item.passed).length ?? 0;
      if (leftFails !== rightFails) {
        return rightFails - leftFails;
      }
      const leftDiffs = (left?.field_diff_summary?.reference?.different ?? 0)
        + (left?.field_diff_summary?.observed?.different ?? 0)
        + (left?.field_diff_summary?.metadata?.different ?? 0);
      const rightDiffs = (right?.field_diff_summary?.reference?.different ?? 0)
        + (right?.field_diff_summary?.observed?.different ?? 0)
        + (right?.field_diff_summary?.metadata?.different ?? 0);
      return rightDiffs - leftDiffs;
    });

    const grid = document.createElement('div');
    grid.className = 'compare-grid';

    for (const item of ordered) {
      const failCount = item?.checklist?.filter((check) => !check.passed).length ?? 0;
      const diffCount = (item?.field_diff_summary?.reference?.different ?? 0)
        + (item?.field_diff_summary?.observed?.different ?? 0)
        + (item?.field_diff_summary?.metadata?.different ?? 0);
      const card = document.createElement('div');
      card.className = 'compare-card';
      card.dataset.tone = failCount > 0 || diffCount > 0 ? 'bad' : 'good';

      const head = document.createElement('div');
      head.className = 'compare-card-head';
      const heading = document.createElement('span');
      heading.className = 'compare-card-title';
      heading.textContent = item?.case_id ?? 'case';
      head.appendChild(heading);
      head.appendChild(createChip(item?.candidate_review_status ?? 'pending_review', item?.candidate_review_status === 'approved' ? 'good' : 'warn'));
      card.appendChild(head);

      const chips = document.createElement('div');
      chips.className = 'chip-row';
      chips.appendChild(createChip(item?.gold_exists ? 'gold:yes' : 'gold:no', item?.gold_exists ? 'good' : 'warn'));
      chips.appendChild(createChip(`check-fail:${failCount}`, failCount > 0 ? 'bad' : 'good'));
      chips.appendChild(createChip(`ref:${item?.field_diff_summary?.reference?.different ?? 0}`));
      chips.appendChild(createChip(`obs:${item?.field_diff_summary?.observed?.different ?? 0}`));
      chips.appendChild(createChip(`meta:${item?.field_diff_summary?.metadata?.different ?? 0}`));
      card.appendChild(chips);

      const values = document.createElement('div');
      values.className = 'compare-values';
      values.appendChild(createCompareValue('Case Type', item?.summary?.candidate_case_type ?? 'n/a'));
      values.appendChild(createCompareValue('Equality', {
        reference_equal: item?.summary?.reference_equal ?? false,
        observed_equal: item?.summary?.observed_equal ?? false,
        metadata_equal: item?.summary?.metadata_equal ?? false,
      }));
      card.appendChild(values);

      grid.appendChild(card);
    }

    section.appendChild(grid);
    container.appendChild(section);
  }

  function appendWikiSuiteComparisonSection(container, comparisons = []) {
    const section = document.createElement('section');
    section.className = 'draft-section';

    const title = document.createElement('strong');
    title.textContent = 'Wiki Suite Compare';
    section.appendChild(title);

    const ordered = [...comparisons].sort((left, right) => {
      const leftFails = left?.checklist?.filter((item) => !item.passed).length ?? 0;
      const rightFails = right?.checklist?.filter((item) => !item.passed).length ?? 0;
      if (leftFails !== rightFails) {
        return rightFails - leftFails;
      }
      const leftDiffs = (left?.field_diff_summary?.reference?.different ?? 0)
        + (left?.field_diff_summary?.metadata?.different ?? 0)
        + (left?.field_diff_summary?.judge?.different ?? 0);
      const rightDiffs = (right?.field_diff_summary?.reference?.different ?? 0)
        + (right?.field_diff_summary?.metadata?.different ?? 0)
        + (right?.field_diff_summary?.judge?.different ?? 0);
      return rightDiffs - leftDiffs;
    });

    const grid = document.createElement('div');
    grid.className = 'compare-grid';

    for (const item of ordered) {
      const failCount = item?.checklist?.filter((check) => !check.passed).length ?? 0;
      const diffCount = (item?.field_diff_summary?.reference?.different ?? 0)
        + (item?.field_diff_summary?.metadata?.different ?? 0)
        + (item?.field_diff_summary?.judge?.different ?? 0);
      const card = document.createElement('div');
      card.className = 'compare-card';
      card.dataset.tone = failCount > 0 || diffCount > 0 ? 'bad' : 'good';

      const head = document.createElement('div');
      head.className = 'compare-card-head';
      const heading = document.createElement('span');
      heading.className = 'compare-card-title';
      heading.textContent = item?.case_id ?? 'case';
      head.appendChild(heading);
      head.appendChild(createChip(item?.candidate_review_status ?? 'pending_review', item?.candidate_review_status === 'approved' ? 'good' : 'warn'));
      card.appendChild(head);

      const chips = document.createElement('div');
      chips.className = 'chip-row';
      chips.appendChild(createChip(item?.observed_exists ? 'observed:yes' : 'observed:no', item?.observed_exists ? 'good' : 'warn'));
      chips.appendChild(createChip(`check-fail:${failCount}`, failCount > 0 ? 'bad' : 'good'));
      chips.appendChild(createChip(`ref:${item?.field_diff_summary?.reference?.different ?? 0}`));
      chips.appendChild(createChip(`meta:${item?.field_diff_summary?.metadata?.different ?? 0}`));
      chips.appendChild(createChip(`judge:${item?.field_diff_summary?.judge?.different ?? 0}`));
      card.appendChild(chips);

      const values = document.createElement('div');
      values.className = 'compare-values';
      values.appendChild(createCompareValue('Observed Run', item?.observed_run_id ?? 'n/a'));
      values.appendChild(createCompareValue('Equality', {
        route_equal: item?.summary?.route_equal ?? false,
        effective_route_equal: item?.summary?.effective_route_equal ?? false,
        recommended_action_equal: item?.summary?.recommended_action_equal ?? false,
        citation_guard_equal: item?.summary?.citation_guard_equal ?? false,
      }));
      card.appendChild(values);

      grid.appendChild(card);
    }

    section.appendChild(grid);
    container.appendChild(section);
  }

  function renderTextDetail(container, text) {
    if (!container) {
      return;
    }
    clearNode(container);
    const pre = document.createElement('pre');
    pre.textContent = String(text ?? '');
    container.appendChild(pre);
  }

  function renderKnowledgeFrontendDetail(container, stage, summary) {
    clearNode(container);
    const wrapper = document.createElement('div');
    wrapper.className = 'draft-detail';

    const stageData = stage?.data ?? {};
    const frontendSummary = stageData?.query_frontend_summary ?? {};
    const decomposition = stageData?.decomposition ?? {};
    const rewrites = stageData?.rewrites ?? {};
    const clarification = stageData?.clarification ?? {};
    const boundary = stageData?.boundary ?? {};
    const subqueries = Array.isArray(decomposition?.subqueries) ? decomposition.subqueries : [];
    const variants = Array.isArray(rewrites?.variants) ? rewrites.variants : [];

    const header = document.createElement('section');
    header.className = 'draft-section';
    const grid = document.createElement('div');
    grid.className = 'draft-grid';
    appendDraftKv(grid, 'Query Mode', stageData?.query_mode ?? summary?.query_mode ?? 'n/a');
    appendDraftKv(grid, 'Boundary', boundary?.action ?? summary?.boundary_action ?? 'n/a');
    appendDraftKv(grid, 'Clarification Required', clarification?.required ? 'yes' : 'no');
    appendDraftKv(grid, 'Decomposition Strategy', frontendSummary?.decomposition_strategy ?? summary?.decomposition_strategy ?? 'n/a');
    appendDraftKv(grid, 'Rewrite Strategy', frontendSummary?.rewrite_strategy ?? summary?.rewrite_strategy ?? 'n/a');
    appendDraftKv(grid, 'Subqueries', frontendSummary?.subquery_count ?? subqueries.length);
    appendDraftKv(grid, 'Rewrites', frontendSummary?.rewrite_count ?? variants.length);
    appendDraftKv(grid, 'Preferred Sources', (frontendSummary?.preferred_sources ?? summary?.preferred_sources ?? []).join(', ') || 'n/a');
    header.appendChild(grid);
    wrapper.appendChild(header);

    const chips = document.createElement('div');
    chips.className = 'chip-row';
    for (const tag of stageData?.intent_tags ?? []) {
      chips.appendChild(createChip(tag));
    }
    wrapper.appendChild(chips);

    appendDraftListSection(wrapper, 'Clarification Questions', clarification?.questions ?? []);
    appendDraftTableSection(wrapper, 'Subqueries', subqueries.map((item) => ({
      subquery_id: item?.subquery_id ?? 'n/a',
      preferred_source: item?.preferred_source ?? 'n/a',
      reason: item?.reason ?? 'n/a',
      query_text: item?.query_text ?? '',
      intent_tags: Array.isArray(item?.intent_tags) ? item.intent_tags.join(', ') : 'n/a',
    })), [
      { key: 'subquery_id', label: 'ID' },
      { key: 'preferred_source', label: 'Source' },
      { key: 'reason', label: 'Reason' },
      { key: 'query_text', label: 'Query' },
      { key: 'intent_tags', label: 'Intent Tags' },
    ]);
    appendDraftTableSection(wrapper, 'Rewrite Variants', variants.map((item) => ({
      variant_id: item?.variant_id ?? 'n/a',
      reason: item?.reason ?? 'n/a',
      text: item?.text ?? '',
    })), [
      { key: 'variant_id', label: 'ID' },
      { key: 'reason', label: 'Reason' },
      { key: 'text', label: 'Text' },
    ]);

    appendDraftJsonSection(wrapper, 'Boundary Policy', boundary);
    knowledgeDetailOutput.appendChild(wrapper);
  }

  return {
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
  };
}
