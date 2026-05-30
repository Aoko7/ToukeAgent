import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditStore } from '../apps/platform/src/audit-store.mjs';
import { createAsyncWorker } from '../apps/platform/src/async-worker.mjs';
import { createEventBus } from '../apps/platform/src/event-bus.mjs';
import { createTaskStore } from '../apps/platform/src/task-store.mjs';
import { createPlatformAdapterRegistry } from '../apps/platform/src/platform-adapter-registry.mjs';
import { createPlatformDeliveryStore } from '../apps/platform/src/delivery-store.mjs';
import { createPlatformDeliveryService } from '../apps/platform/src/delivery-service.mjs';

test('platform adapter registry renders different payloads for web and slack', () => {
  const registry = createPlatformAdapterRegistry();
  const task = {
    task_id: 'task_render_1',
    trace_id: 'trace_render_1',
    message: {
      source_platform: 'web',
      channel_id: 'console',
      conversation_id: 'conv_render_1',
      attachments: [
        {
          type: 'image',
          url: 'https://example.com/diagram.png',
          alt_text: 'architecture diagram',
        },
      ],
    },
  };
  const runState = {
    task_id: 'task_render_1',
    trace_id: 'trace_render_1',
    output: {
      final_text: 'Hello world',
      attachments: [
        {
          type: 'file',
          name: 'runbook.pdf',
          url: 'https://example.com/runbook.pdf',
          mime_type: 'application/pdf',
        },
      ],
    },
    step_results: [
      {
        step_id: 'step_retrieve',
        output: {
          route: { mode: 'wiki-first' },
          quality: {
            retrieval_score: 0.93,
            citation_score: 0.88,
          },
          citations: [
            {
              title: 'Architecture overview',
              doc_id: 'doc_architecture_overview',
              source_type: 'rag',
              score: 0.95,
            },
          ],
          items: [
            {
              title: 'Delivery loop',
              entry_id: 'wiki_delivery_workflow',
              source_type: 'wiki',
              score: 0.88,
            },
          ],
        },
      },
    ],
  };

  const web = registry.render({
    target_platform: 'web',
    responseText: 'Hello world',
    task,
    persona: { persona_id: 'researcher', name: 'Researcher' },
    plan: { plan_id: 'plan_render_1', summary: 'Render response' },
    traceId: 'trace_render_1',
    sourcePlatform: 'web',
    runState,
  });
  const slack = registry.render({
    target_platform: 'slack',
    responseText: 'Hello world',
    task,
    persona: { persona_id: 'researcher', name: 'Researcher' },
    plan: { plan_id: 'plan_render_1', summary: 'Render response' },
    traceId: 'trace_render_1',
    sourcePlatform: 'web',
    runState,
  });
  const telegram = registry.render({
    target_platform: 'telegram',
    responseText: 'Hello world',
    task,
    persona: { persona_id: 'researcher', name: 'Researcher' },
    plan: { plan_id: 'plan_render_1', summary: 'Render response' },
    traceId: 'trace_render_1',
    sourcePlatform: 'web',
    runState,
  });

  assert.equal(web.profile.platform_id, 'web');
  assert.equal(slack.profile.platform_id, 'slack');
  assert.equal(telegram.profile.platform_id, 'telegram');
  assert.equal(web.rendered_payload.kind, 'web_delivery');
  assert.equal(slack.rendered_payload.blocks[0].type, 'section');
  assert.equal(web.rendered_payload.citations.length, 1);
  assert.equal(web.rendered_payload.attachments.length, 1);
  assert.equal(web.rendered_payload.media.length, 1);
  assert.ok(slack.rendered_payload.blocks.some((block) => block.type === 'image'));
  assert.equal(slack.rendered_payload.citations.length, 1);
  assert.equal(slack.rendered_payload.attachments.length, 1);
  assert.ok(telegram.rendered_payload.text.includes('Sources:'));
  assert.equal(telegram.rendered_payload.media_group.length, 1);
  assert.notDeepEqual(web.rendered_payload, slack.rendered_payload);
});

test('delivery service queues deliveries and writes callback receipts', async () => {
  const auditStore = createAuditStore();
  const taskStore = createTaskStore();
  const eventBus = createEventBus();
  const worker = createAsyncWorker({ bus: eventBus });
  const registry = createPlatformAdapterRegistry();
  const deliveryStore = createPlatformDeliveryStore();
  const service = createPlatformDeliveryService({
    registry,
    deliveryStore,
    worker,
    eventBus,
    auditStore,
    taskStore,
  });

  taskStore.upsert('task_delivery_1', {
    status: 'completed',
    phase: 'completed',
    message: {
      source_platform: 'web',
      channel_id: 'console',
      conversation_id: 'conv_delivery_1',
      message_id: 'msg_delivery_1',
      content_preview: 'hello delivery',
    },
  });

  const batch = await service.queueTaskDeliveries({
    task: taskStore.get('task_delivery_1'),
    persona: { persona_id: 'researcher', name: 'Researcher' },
    plan: { plan_id: 'plan_delivery_1', summary: 'Delivery test' },
    runState: {
      task_id: 'task_delivery_1',
      trace_id: 'trace_delivery_1',
      output: {
        final_text: 'Deliver this response',
        attachments: [
          {
            type: 'file',
            name: 'deliverable.pdf',
            url: 'https://example.com/deliverable.pdf',
          },
        ],
      },
      step_results: [
        {
          step_id: 'step_retrieve',
          output: {
            route: { mode: 'rag-first' },
            quality: {
              retrieval_score: 0.91,
              citation_score: 0.89,
            },
            citations: [
              {
                title: 'Delivery loop',
                doc_id: 'doc_delivery_loop',
                source_type: 'rag',
                score: 0.91,
              },
            ],
          },
        },
      ],
    },
    targetPlatforms: ['slack'],
  });

  assert.equal(batch.deliveries.length, 1);
  const delivery = batch.deliveries[0].delivery;
  assert.equal(delivery.target_platform, 'slack');
  assert.equal(delivery.status, 'sent');
  assert.equal(delivery.callback_state, 'awaiting_callback');
  assert.equal(delivery.rendered_payload.blocks[0].type, 'section');
  assert.equal(delivery.rendered_payload.citations.length, 1);
  assert.equal(delivery.rendered_payload.attachments.length, 1);

  const callback = await service.handleDeliveryCallback({
    delivery_id: delivery.delivery_id,
    status: 'delivered',
    callback_state: 'acknowledged',
    external_message_id: 'slack_msg_1',
    body: {
      ok: true,
    },
  });

  assert.equal(callback.delivery.status, 'delivered');
  assert.equal(callback.delivery.callback_state, 'acknowledged');
  assert.equal(callback.delivery.receipts.length, 2);
  assert.equal(deliveryStore.list({ taskId: 'task_delivery_1' }).length, 1);
  assert.ok(auditStore.list('task_delivery_1').some((entry) => entry.kind === 'delivery.queued'));
  assert.ok(auditStore.list('task_delivery_1').some((entry) => entry.kind === 'delivery.sent'));
  assert.ok(auditStore.list('task_delivery_1').some((entry) => entry.kind === 'delivery.callback_received'));
  assert.equal(taskStore.get('task_delivery_1').metadata.latest_delivery_status, 'delivered');
});
