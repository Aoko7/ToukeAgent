import { randomUUID } from 'node:crypto';

function clone(value) {
  return structuredClone(value);
}

function normalizeTargets({ targetPlatform, targetPlatforms, message }) {
  const explicitTargets = [
    ...(Array.isArray(targetPlatforms) ? targetPlatforms : []),
    ...(targetPlatform ? [targetPlatform] : []),
    ...(Array.isArray(message?.metadata?.delivery_targets) ? message.metadata.delivery_targets : []),
    ...(Array.isArray(message?.metadata?.target_platforms) ? message.metadata.target_platforms : []),
  ]
    .filter(Boolean)
    .map((item) => String(item).toLowerCase());

  if (explicitTargets.length > 0) {
    return Array.from(new Set(explicitTargets));
  }

  if (message?.source_platform) {
    return [String(message.source_platform).toLowerCase()];
  }

  return ['generic'];
}

function buildResponseText({ responseText, runState }) {
  const text = String(responseText ?? runState?.output?.final_text ?? '').trim();
  return text;
}

export function createPlatformDeliveryService({
  registry,
  deliveryStore,
  worker,
  eventBus = null,
  auditStore = null,
  taskStore = null,
} = {}) {
  if (!registry) {
    throw new Error('registry is required');
  }
  if (!deliveryStore) {
    throw new Error('deliveryStore is required');
  }

  worker?.register('platform.deliver', async (jobPayload) => processDelivery(jobPayload));

  function appendAudit(taskId, traceId, kind, payload) {
    auditStore?.append(taskId, {
      trace_id: traceId,
      kind,
      payload,
    });
  }

  async function queueDelivery({
    task,
    persona,
    plan,
    runState,
    responseText,
    targetPlatform,
    sourcePlatform = task?.message?.source_platform ?? null,
    metadata = {},
  } = {}) {
    const taskId = task?.task_id ?? runState?.task_id ?? null;
    const traceId = task?.trace_id ?? runState?.trace_id ?? taskId;
    if (!taskId || !traceId) {
      throw new Error('task and trace_id are required to queue delivery');
    }

    const delivery = deliveryStore.create({
      task_id: taskId,
      trace_id: traceId,
      source_platform: sourcePlatform,
      target_platform: targetPlatform,
      channel_id: task?.message?.channel_id ?? null,
      conversation_id: task?.message?.conversation_id ?? null,
      source_message_id: task?.message?.message_id ?? null,
      response_message_id: runState?.output?.message_id ?? `out_${taskId}_${randomUUID()}`,
      rendered_payload: {},
      status: 'queued',
      callback_state: 'pending',
      metadata: {
        ...clone(metadata),
        persona_id: persona?.persona_id ?? null,
        plan_id: plan?.plan_id ?? null,
      },
    });

    appendAudit(taskId, traceId, 'delivery.queued', {
      delivery_id: delivery.delivery_id,
      target_platform: targetPlatform,
      source_platform: sourcePlatform,
    });
    await eventBus?.publish('delivery.queued', {
      trace_id: traceId,
      task_id: taskId,
      delivery_id: delivery.delivery_id,
      target_platform: targetPlatform,
      source_platform: sourcePlatform,
    });

    const receipt = await worker.dispatch({
      job_type: 'platform.deliver',
      payload: {
        delivery_id: delivery.delivery_id,
        task_id: taskId,
        trace_id: traceId,
        response_text: buildResponseText({ responseText, runState }),
        persona,
        plan,
        run_state: runState,
        task,
        metadata,
      },
      trace_id: traceId,
      task_id: taskId,
      run_id: runState?.run_id ?? task?.run_state?.run_id ?? null,
      persona_id: persona?.persona_id ?? null,
      metadata: {
        target_platform: targetPlatform,
      },
    });

    return {
      delivery: deliveryStore.get(delivery.delivery_id),
      receipt,
    };
  }

  async function queueTaskDeliveries({
    task,
    persona,
    plan,
    runState,
    responseText,
    targetPlatforms = null,
    metadata = {},
  } = {}) {
    const targets = normalizeTargets({
      targetPlatform: metadata.target_platform ?? null,
      targetPlatforms,
      message: task?.message_snapshot ?? task?.message ?? null,
    });

    const deliveries = [];
    for (const targetPlatform of targets) {
      deliveries.push(await queueDelivery({
        task,
        persona,
        plan,
        runState,
        responseText,
        targetPlatform,
        sourcePlatform: task?.message?.source_platform ?? null,
        metadata,
      }));
    }

    taskStore?.upsert(task.task_id, {
      metadata: {
        outbound_delivery_count: deliveries.length,
        outbound_delivery_targets: targets,
        outbound_delivery_ids: deliveries.map((item) => item.delivery.delivery_id),
        outbound_delivery_status: deliveries.at(-1)?.delivery?.status ?? null,
      },
      checkpoint: {
        kind: 'delivery.sent',
        summary: `Queued ${deliveries.length} outbound delivery target(s)`,
        metadata: {
          target_platforms: targets,
          delivery_ids: deliveries.map((item) => item.delivery.delivery_id),
        },
      },
    });

    await eventBus?.publish('delivery.batch_completed', {
      trace_id: task.trace_id,
      task_id: task.task_id,
      target_platforms: targets,
      delivery_ids: deliveries.map((item) => item.delivery.delivery_id),
    });

    return {
      task_id: task.task_id,
      trace_id: task.trace_id,
      target_platforms: targets,
      deliveries,
    };
  }

  async function processDelivery(jobPayload = {}) {
    const current = deliveryStore.get(jobPayload.delivery_id);
    if (!current) {
      throw new Error(`Unknown delivery: ${jobPayload.delivery_id}`);
    }

    const adapterRender = registry.render({
      target_platform: current.target_platform,
      responseText: jobPayload.response_text ?? '',
      task: jobPayload.task ?? null,
      persona: jobPayload.persona ?? null,
      plan: jobPayload.plan ?? null,
      runState: jobPayload.run_state ?? null,
      traceId: current.trace_id,
      sourcePlatform: current.source_platform,
      metadata: {
        ...(current.metadata ?? {}),
        ...(jobPayload.metadata ?? {}),
      },
    });

    const providerReference = current.provider_reference ?? `provider_${randomUUID()}`;
    deliveryStore.update(current.delivery_id, {
      adapter_profile_id: adapterRender.profile.platform_id,
      rendered_payload: adapterRender.rendered_payload,
      status: 'sent',
      callback_state: adapterRender.profile.callback_supported ? 'awaiting_callback' : 'not_supported',
      provider_reference: providerReference,
      submitted_at: new Date().toISOString(),
      metadata: {
        adapter_profile_id: adapterRender.profile.platform_id,
        render_mode: adapterRender.profile.render_mode,
        callback_supported: adapterRender.profile.callback_supported,
      },
    });

    const receipt = deliveryStore.appendReceipt(current.delivery_id, {
      status: 'sent',
      callback_state: adapterRender.profile.callback_supported ? 'awaiting_callback' : 'not_supported',
      provider_reference: providerReference,
      external_message_id: `ext_${randomUUID()}`,
      http_status: 200,
      body: {
        target_platform: current.target_platform,
        rendered_payload: adapterRender.rendered_payload,
      },
      metadata: {
        adapter_profile_id: adapterRender.profile.platform_id,
        render_mode: adapterRender.profile.render_mode,
      },
    });

    appendAudit(current.task_id, current.trace_id, 'delivery.rendered', {
      delivery_id: current.delivery_id,
      target_platform: current.target_platform,
      adapter_profile_id: adapterRender.profile.platform_id,
    });
    appendAudit(current.task_id, current.trace_id, 'delivery.sent', receipt);

    await eventBus?.publish('delivery.rendered', {
      trace_id: current.trace_id,
      task_id: current.task_id,
      delivery_id: current.delivery_id,
      target_platform: current.target_platform,
      adapter_profile_id: adapterRender.profile.platform_id,
    });
    await eventBus?.publish('delivery.sent', {
      trace_id: current.trace_id,
      task_id: current.task_id,
      delivery_id: current.delivery_id,
      target_platform: current.target_platform,
      provider_reference: providerReference,
    });

    taskStore?.upsert(current.task_id, {
      metadata: {
        latest_delivery_id: current.delivery_id,
        latest_delivery_status: 'sent',
        latest_delivery_platform: current.target_platform,
        latest_delivery_provider_reference: providerReference,
      },
      checkpoint: {
        kind: 'delivery.sent',
        summary: `Delivery sent to ${current.target_platform}`,
        metadata: {
          delivery_id: current.delivery_id,
          provider_reference: providerReference,
        },
      },
    });

    return {
      delivery: deliveryStore.get(current.delivery_id),
      receipt,
      adapter_profile: adapterRender.profile,
    };
  }

  async function handleDeliveryCallback(input = {}) {
    const delivery = input.delivery_id
      ? deliveryStore.get(input.delivery_id)
      : deliveryStore.findByProviderReference(input.provider_reference);

    if (!delivery) {
      throw new Error('Unknown delivery for callback');
    }

    const status = input.status ?? 'delivered';
    const callbackState = input.callback_state ?? 'acknowledged';
    const recordedAt = input.recorded_at ?? new Date().toISOString();

    const receipt = deliveryStore.appendReceipt(delivery.delivery_id, {
      receipt_id: input.receipt_id ?? `receipt_${randomUUID()}`,
      task_id: delivery.task_id,
      trace_id: delivery.trace_id,
      target_platform: delivery.target_platform,
      adapter_profile_id: delivery.adapter_profile_id,
      status,
      callback_state: callbackState,
      provider_reference: input.provider_reference ?? delivery.provider_reference ?? null,
      external_message_id: input.external_message_id ?? null,
      http_status: input.http_status ?? 200,
      body: input.body ?? {},
      error: input.error ?? null,
      recorded_at: recordedAt,
      metadata: {
        ...(delivery.metadata ?? {}),
        ...(input.metadata ?? {}),
      },
    });

    deliveryStore.update(delivery.delivery_id, {
      status,
      callback_state: callbackState,
      provider_reference: input.provider_reference ?? delivery.provider_reference ?? null,
      delivered_at: status === 'delivered' ? recordedAt : delivery.delivered_at ?? null,
      metadata: {
        latest_callback_status: status,
        latest_callback_state: callbackState,
      },
    });

    appendAudit(delivery.task_id, delivery.trace_id, 'delivery.callback_received', receipt);
    await eventBus?.publish('delivery.callback_received', {
      trace_id: delivery.trace_id,
      task_id: delivery.task_id,
      delivery_id: delivery.delivery_id,
      target_platform: delivery.target_platform,
      status,
      callback_state: callbackState,
    });

    taskStore?.upsert(delivery.task_id, {
      metadata: {
        latest_delivery_status: status,
        latest_delivery_callback_state: callbackState,
        latest_delivery_delivered_at: status === 'delivered' ? recordedAt : null,
      },
      checkpoint: {
        kind: 'delivery.callback_received',
        summary: `Delivery callback received: ${status}`,
        metadata: {
          delivery_id: delivery.delivery_id,
          callback_state: callbackState,
        },
      },
    });

    return {
      delivery: deliveryStore.get(delivery.delivery_id),
      receipt,
    };
  }

  return {
    handleDeliveryCallback,
    listAdapters: () => registry.list(),
    listDeliveries: (filters = {}) => deliveryStore.list(filters),
    listReceipts: (filters = {}) => deliveryStore.listReceipts(filters),
    processDelivery,
    queueDelivery,
    queueTaskDeliveries,
  };
}
