import { createToolCallResult } from '../../../packages/contracts/src/index.mjs';
import { redactValue } from './secret-manager.mjs';

function clone(value) {
  return structuredClone(value);
}

function normalizePath(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim().replace(/\\/g, '/');
  if (!text) {
    return null;
  }
  const compact = text.replace(/\/+/g, '/');
  return compact.length > 1 ? compact.replace(/\/$/, '') : compact;
}

function asPathList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizePath(item)).filter(Boolean);
}

function normalizeToken(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const token = String(value).trim().toLowerCase();
  return token || null;
}

function asTokenList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizeToken(item)).filter(Boolean);
}

function normalizeEgressPolicy(value = {}) {
  const bindings = Array.isArray(
    value.provider_host_bindings ?? value.providerHostBindings ?? value.bindings ?? value.routes,
  )
    ? value.provider_host_bindings ?? value.providerHostBindings ?? value.bindings ?? value.routes
    : [];
  return {
    hosts: asTokenList(value.hosts ?? value.domains),
    providers: asTokenList(value.providers ?? value.services),
    providerHostBindings: bindings
      .map((binding) => ({
        provider: normalizeToken(binding?.provider ?? binding?.service ?? '*'),
        hosts: asTokenList(binding?.hosts ?? binding?.domains ?? (binding?.host ? [binding.host] : [])),
      }))
      .filter((binding) => binding.provider && binding.hosts.length > 0),
  };
}

function normalizeNetworkIntentTarget(value = {}) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const url = String(value.url ?? value.endpoint ?? value.base_url ?? value.baseUrl ?? '').trim();
  const host = normalizeToken(value.host ?? value.hostname ?? value.domain) ?? extractHostFromUrlLike(url);
  const provider = normalizeToken(value.provider ?? value.service ?? value.provider_id ?? value.providerId);
  const purpose = String(value.purpose ?? value.intent ?? value.label ?? '').trim() || null;
  if (!host && !provider && !url) {
    return null;
  }
  return {
    host,
    provider,
    url: url || null,
    purpose,
  };
}

function normalizeNetworkIntent(value = {}) {
  const intent = value && typeof value === 'object' ? value : {};
  const rawTargets = Array.isArray(intent.targets ?? intent.endpoints ?? intent.requests)
    ? intent.targets ?? intent.endpoints ?? intent.requests
    : [];
  return {
    targets: rawTargets
      .map((target) => normalizeNetworkIntentTarget(target))
      .filter(Boolean),
  };
}

function normalizeDynamicAccessPolicy(value = {}) {
  const policy = value && typeof value === 'object' ? value : {};
  return {
    egressAllowlist: normalizeEgressPolicy(policy.egress_allowlist),
  };
}

function parseHostRule(rule) {
  const normalized = normalizeToken(rule);
  if (!normalized) {
    return null;
  }
  if (normalized === '*') {
    return { kind: 'any', value: '*' };
  }
  if (normalized.startsWith('*.')) {
    return { kind: 'suffix', value: normalized.slice(2) };
  }
  if (normalized.startsWith('.')) {
    return { kind: 'suffix', value: normalized.slice(1) };
  }
  return { kind: 'exact', value: normalized };
}

function formatHostRule(rule) {
  if (!rule) {
    return null;
  }
  if (rule.kind === 'any') {
    return '*';
  }
  if (rule.kind === 'suffix') {
    return `*.${rule.value}`;
  }
  return rule.value;
}

function hostRuleMatches(rule, host) {
  const parsedRule = typeof rule === 'string' ? parseHostRule(rule) : rule;
  const normalizedHost = normalizeToken(host);
  if (!parsedRule || !normalizedHost) {
    return false;
  }
  if (parsedRule.kind === 'any') {
    return true;
  }
  if (parsedRule.kind === 'suffix') {
    return normalizedHost === parsedRule.value || normalizedHost.endsWith(`.${parsedRule.value}`);
  }
  return normalizedHost === parsedRule.value;
}

function combineHostRules(leftRule, rightRule) {
  const left = typeof leftRule === 'string' ? parseHostRule(leftRule) : leftRule;
  const right = typeof rightRule === 'string' ? parseHostRule(rightRule) : rightRule;
  if (!left || !right) {
    return null;
  }
  if (left.kind === 'any') {
    return formatHostRule(right);
  }
  if (right.kind === 'any') {
    return formatHostRule(left);
  }
  if (left.kind === 'exact' && right.kind === 'exact') {
    return left.value === right.value ? left.value : null;
  }
  if (left.kind === 'exact' && right.kind === 'suffix') {
    return hostRuleMatches(right, left.value) ? left.value : null;
  }
  if (left.kind === 'suffix' && right.kind === 'exact') {
    return hostRuleMatches(left, right.value) ? right.value : null;
  }
  if (left.kind === 'suffix' && right.kind === 'suffix') {
    if (left.value === right.value || left.value.endsWith(`.${right.value}`)) {
      return formatHostRule(left);
    }
    if (right.value.endsWith(`.${left.value}`)) {
      return formatHostRule(right);
    }
  }
  return null;
}

function combineTokenRules(leftRule, rightRule) {
  const left = normalizeToken(leftRule);
  const right = normalizeToken(rightRule);
  if (!left || !right) {
    return null;
  }
  if (left === '*') {
    return right;
  }
  if (right === '*') {
    return left;
  }
  return left === right ? left : null;
}

function uniqueList(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function resolveHostAllowlist(environmentRules = [], constraintRules = []) {
  const env = uniqueList(environmentRules.map((item) => formatHostRule(parseHostRule(item))));
  const constraint = uniqueList(constraintRules.map((item) => formatHostRule(parseHostRule(item))));
  if (env.length > 0 && constraint.length > 0) {
    return uniqueList(env.flatMap((envRule) => constraint.map((constraintRule) => combineHostRules(envRule, constraintRule)).filter(Boolean)));
  }
  if (env.length > 0) {
    return env;
  }
  if (constraint.length > 0) {
    return constraint;
  }
  return [];
}

function resolveTokenAllowlist(environmentRules = [], constraintRules = []) {
  const env = uniqueList(environmentRules.map((item) => normalizeToken(item)));
  const constraint = uniqueList(constraintRules.map((item) => normalizeToken(item)));
  if (env.length > 0 && constraint.length > 0) {
    return uniqueList(env.flatMap((envRule) => constraint.map((constraintRule) => combineTokenRules(envRule, constraintRule)).filter(Boolean)));
  }
  if (env.length > 0) {
    return env;
  }
  if (constraint.length > 0) {
    return constraint;
  }
  return [];
}

function resolveProviderHostBindings(environmentBindings = [], constraintBindings = []) {
  const env = Array.isArray(environmentBindings) ? environmentBindings : [];
  const constraint = Array.isArray(constraintBindings) ? constraintBindings : [];
  if (env.length === 0 && constraint.length === 0) {
    return [];
  }
  if (env.length === 0) {
    return constraint.map((binding) => ({
      provider: normalizeToken(binding.provider),
      hosts: resolveHostAllowlist([], binding.hosts ?? []),
    })).filter((binding) => binding.provider && binding.hosts.length > 0);
  }
  if (constraint.length === 0) {
    return env.map((binding) => ({
      provider: normalizeToken(binding.provider),
      hosts: resolveHostAllowlist(binding.hosts ?? [], []),
    })).filter((binding) => binding.provider && binding.hosts.length > 0);
  }

  const combined = [];
  for (const envBinding of env) {
    for (const constraintBinding of constraint) {
      const provider = combineTokenRules(envBinding.provider, constraintBinding.provider);
      if (!provider) {
        continue;
      }
      const hosts = resolveHostAllowlist(envBinding.hosts ?? [], constraintBinding.hosts ?? []);
      if (hosts.length === 0) {
        continue;
      }
      combined.push({ provider, hosts });
    }
  }
  return combined;
}

function findProviderHostBinding(bindings = [], provider = null) {
  const normalizedProvider = normalizeToken(provider);
  if (!normalizedProvider) {
    return null;
  }
  return bindings.find((binding) => binding.provider === normalizedProvider || binding.provider === '*') ?? null;
}

function extractHostFromUrlLike(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }
  try {
    return normalizeToken(new URL(text).hostname);
  } catch {
    return null;
  }
}

function collectRequestedPaths(request, context = {}) {
  const paths = new Set();

  const add = (value) => {
    const normalized = normalizePath(value);
    if (normalized) {
      paths.add(normalized);
    }
  };

  for (const value of asPathList(context.requested_paths)) {
    add(value);
  }

  const args = request?.arguments ?? {};
  for (const key of [
    'path',
    'file_path',
    'filePath',
    'directory_path',
    'directoryPath',
    'source_path',
    'sourcePath',
    'destination_path',
    'destinationPath',
  ]) {
    add(args[key]);
  }

  return Array.from(paths);
}

function collectRequestedNetworkIntent(request, context = {}) {
  const explicitIntent = normalizeNetworkIntent(request?.network_intent ?? context.network_intent);
  if (explicitIntent.targets.length > 0) {
    const hosts = new Set();
    const providers = new Set();
    const urls = new Set();
    const targets = [];

    for (const target of explicitIntent.targets) {
      const normalized = normalizeNetworkIntentTarget(target);
      if (!normalized) {
        continue;
      }
      targets.push(normalized);
      if (normalized.host) {
        hosts.add(normalized.host);
      }
      if (normalized.provider) {
        providers.add(normalized.provider);
      }
      if (normalized.url) {
        urls.add(normalized.url);
      }
      if (normalized.url && !normalized.host) {
        const extractedHost = extractHostFromUrlLike(normalized.url);
        if (extractedHost) {
          hosts.add(extractedHost);
        }
      }
    }

    return {
      source: 'explicit',
      requested_network_intent: { targets },
      requested_targets: targets,
      requested_hosts: Array.from(hosts),
      requested_providers: Array.from(providers),
      requested_urls: Array.from(urls),
      hosts: Array.from(hosts),
      providers: Array.from(providers),
      urls: Array.from(urls),
    };
  }

  const hosts = new Set();
  const providers = new Set();
  const urls = new Set();
  const targets = new Set();

  const addHost = (value) => {
    const normalized = normalizeToken(value);
    if (normalized) {
      hosts.add(normalized);
    }
  };
  const addProvider = (value) => {
    const normalized = normalizeToken(value);
    if (normalized) {
      providers.add(normalized);
    }
  };
  const addUrl = (value) => {
    const normalized = String(value ?? '').trim();
    if (normalized) {
      urls.add(normalized);
    }
  };

  const addTarget = (target) => {
    const normalized = normalizeNetworkIntentTarget(target);
    if (normalized) {
      targets.add(JSON.stringify(normalized));
      if (normalized.host) {
        addHost(normalized.host);
      }
      if (normalized.provider) {
        addProvider(normalized.provider);
      }
      if (normalized.url) {
        addUrl(normalized.url);
      }
    }
  };

  for (const value of asTokenList(context.requested_hosts)) {
    addHost(value);
    addTarget({ host: value });
  }
  for (const value of asTokenList(context.requested_providers)) {
    addProvider(value);
    addTarget({ provider: value });
  }

  const args = request?.arguments ?? {};
  for (const key of ['host', 'hostname', 'domain', 'url_host', 'urlHost']) {
    const host = args[key];
    addHost(host);
    addTarget({ host });
  }
  for (const key of ['url', 'endpoint', 'base_url', 'baseUrl']) {
    const url = args[key];
    addUrl(url);
    addTarget({ url });
  }
  for (const key of ['provider', 'service', 'provider_id', 'providerId']) {
    const provider = args[key];
    addProvider(provider);
    addTarget({ provider });
  }

  return {
    source: hosts.size > 0 || providers.size > 0 || urls.size > 0 ? 'derived' : 'none',
    requested_network_intent: {
      targets: Array.from(targets).map((serialized) => JSON.parse(serialized)),
    },
    requested_targets: Array.from(targets).map((serialized) => JSON.parse(serialized)),
    requested_hosts: Array.from(hosts),
    requested_providers: Array.from(providers),
    requested_urls: Array.from(urls),
    hosts: Array.from(hosts),
    providers: Array.from(providers),
    urls: Array.from(urls),
  };
}

function isPathWithinRoot(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

function isHighRisk(definition) {
  return ['high', 'critical'].includes(definition.risk_level);
}

export function createRestrictedExecutionEnvironment({
  name = 'restricted',
  enforceApproval = false,
  redactor = redactValue,
  policy = {},
} = {}) {
  const environmentPolicy = {
    allowNetwork: policy.allowNetwork ?? false,
    filesystemScope: policy.filesystemScope ?? 'none',
    allowShell: policy.allowShell ?? false,
    allowedPaths: asPathList(policy.allowedPaths ?? policy.workspaceRoots),
    egressAllowlist: normalizeEgressPolicy(policy.egressAllowlist ?? policy.networkAllowlist),
  };

  function allowsFilesystem(requiredScope) {
    const order = new Map([
      ['none', 0],
      ['read_only', 1],
      ['workspace_write', 2],
      ['full', 3],
    ]);
    return (order.get(environmentPolicy.filesystemScope) ?? 0) >= (order.get(requiredScope ?? 'none') ?? 0);
  }

  function canExecute(definition, context = {}) {
    if (enforceApproval && (definition.requires_approval || isHighRisk(definition)) && !context.approved) {
      return {
        allowed: false,
        reason: 'approval_required',
        summary: 'Tool execution requires approval',
      };
    }

    const constraints = definition.execution_constraints ?? {};
    if (constraints.network_access && !environmentPolicy.allowNetwork) {
      return {
        allowed: false,
        reason: 'network_access_blocked',
        summary: 'Tool requires network access that is not allowed in the active restricted environment',
      };
    }

    let networkAssessment = null;

    if (constraints.network_access && environmentPolicy.allowNetwork) {
      const requestedEgress = collectRequestedNetworkIntent(context.request, context);
      const requestedHosts = requestedEgress.requested_hosts ?? requestedEgress.hosts ?? [];
      const requestedProviders = requestedEgress.requested_providers ?? requestedEgress.providers ?? [];
      const requestedUrls = requestedEgress.requested_urls ?? requestedEgress.urls ?? [];
      const dynamicAccessPolicy = normalizeDynamicAccessPolicy(context.access_policy);
      const constraintEgress = normalizeEgressPolicy(constraints.egress_allowlist);
      const environmentScopedHosts = resolveHostAllowlist(
        environmentPolicy.egressAllowlist.hosts,
        dynamicAccessPolicy.egressAllowlist.hosts,
      );
      const effectiveHosts = resolveHostAllowlist(
        environmentScopedHosts,
        constraintEgress.hosts,
      );
      const environmentScopedProviders = resolveTokenAllowlist(
        environmentPolicy.egressAllowlist.providers,
        dynamicAccessPolicy.egressAllowlist.providers,
      );
      const effectiveProviders = resolveTokenAllowlist(
        environmentScopedProviders,
        constraintEgress.providers,
      );
      const environmentScopedProviderHostBindings = resolveProviderHostBindings(
        environmentPolicy.egressAllowlist.providerHostBindings,
        dynamicAccessPolicy.egressAllowlist.providerHostBindings,
      );
      const effectiveProviderHostBindings = resolveProviderHostBindings(
        environmentScopedProviderHostBindings,
        constraintEgress.providerHostBindings,
      );
      networkAssessment = {
        network_intent_source: requestedEgress.source,
        requested_network_intent: requestedEgress.requested_network_intent,
        requested_hosts: requestedHosts,
        requested_providers: requestedProviders,
        requested_urls: requestedUrls,
        requested_targets: requestedEgress.requested_targets,
        blocked_hosts: [],
        blocked_providers: [],
        allowed_hosts: effectiveHosts,
        allowed_providers: effectiveProviders,
        dynamic_allowed_hosts: environmentScopedHosts,
        dynamic_allowed_providers: environmentScopedProviders,
        blocked_provider_host_pairs: [],
        dynamic_allowed_provider_host_bindings: environmentScopedProviderHostBindings,
        allowed_provider_host_bindings: effectiveProviderHostBindings,
      };
      const blockedHosts = requestedHosts.filter((host) => effectiveHosts.length > 0 && !effectiveHosts.some((rule) => hostRuleMatches(rule, host)));
      const blockedProviders = requestedProviders.filter((provider) => effectiveProviders.length > 0 && !effectiveProviders.includes(provider));
      const blockedProviderHostPairs = [];

      for (const provider of requestedProviders) {
        const binding = findProviderHostBinding(effectiveProviderHostBindings, provider);
        if (!binding) {
          continue;
        }
        for (const host of requestedHosts) {
          if (!binding.hosts.some((rule) => hostRuleMatches(rule, host))) {
            blockedProviderHostPairs.push({ provider, host });
          }
        }
      }

      if (blockedHosts.length > 0 || blockedProviders.length > 0 || blockedProviderHostPairs.length > 0) {
        return {
          allowed: false,
          reason: 'network_egress_blocked',
          summary: `Tool requested network targets outside the active restricted environment allowlist: ${[
            ...blockedHosts,
            ...blockedProviders,
            ...blockedProviderHostPairs.map((item) => `${item.provider}@${item.host}`),
          ].join(', ')}`,
          ...networkAssessment,
          blocked_hosts: blockedHosts,
          blocked_providers: blockedProviders,
          blocked_provider_host_pairs: blockedProviderHostPairs,
        };
      }
    }

    if (!allowsFilesystem(constraints.filesystem_scope)) {
      return {
        allowed: false,
        reason: 'filesystem_scope_blocked',
        summary: `Tool requires filesystem scope ${constraints.filesystem_scope}, which exceeds the active restricted environment`,
      };
    }

    const requestedPaths = collectRequestedPaths(context.request, context);
    if (
      requestedPaths.length > 0
      && constraints.filesystem_scope !== 'none'
      && environmentPolicy.filesystemScope !== 'full'
      && environmentPolicy.allowedPaths.length > 0
    ) {
      const constraintRoots = asPathList(constraints.path_allowlist);
      const effectiveRoots = constraintRoots.length > 0
        ? environmentPolicy.allowedPaths.filter((root) => constraintRoots.some((allowedRoot) => (
          isPathWithinRoot(root, allowedRoot) || isPathWithinRoot(allowedRoot, root)
        )))
        : environmentPolicy.allowedPaths;
      const blockedPaths = requestedPaths.filter((path) => !effectiveRoots.some((root) => isPathWithinRoot(path, root)));

      if (blockedPaths.length > 0) {
        return {
          allowed: false,
          reason: 'filesystem_path_blocked',
          summary: `Tool requested filesystem paths outside the active restricted environment allowlist: ${blockedPaths.join(', ')}`,
          requested_paths: requestedPaths,
          blocked_paths: blockedPaths,
          allowed_paths: effectiveRoots,
        };
      }
    }

    if (constraints.shell_access && !environmentPolicy.allowShell) {
      return {
        allowed: false,
        reason: 'shell_access_blocked',
        summary: 'Tool requires shell access that is not allowed in the active restricted environment',
      };
    }

    return {
      allowed: true,
      reason: 'ok',
      summary: 'Restricted execution policy check passed',
      ...(networkAssessment ?? {}),
    };
  }

  function prepareInput(input) {
    return redactor(clone(input));
  }

  function prepareOutput(output) {
    return redactor(clone(output));
  }

  async function execute({ definition, request, handler, context = {} }) {
    const decision = canExecute(definition, {
      ...context,
      request,
    });
    if (!decision.allowed) {
      return createToolCallResult({
        call_id: request.call_id,
        status: 'error',
        error_code: decision.reason,
        summary: decision.summary,
        result: {},
        evidence: [],
        metrics: {
          environment: name,
          restricted: true,
          blocked: true,
          network_intent_source: decision.network_intent_source ?? 'none',
          requested_network_intent: decision.requested_network_intent ?? null,
          requested_hosts: decision.requested_hosts ?? [],
          requested_providers: decision.requested_providers ?? [],
          requested_urls: decision.requested_urls ?? [],
          requested_targets: decision.requested_targets ?? [],
          blocked_hosts: decision.blocked_hosts ?? [],
          blocked_providers: decision.blocked_providers ?? [],
          allowed_hosts: decision.allowed_hosts ?? environmentPolicy.egressAllowlist.hosts,
          allowed_providers: decision.allowed_providers ?? environmentPolicy.egressAllowlist.providers,
          dynamic_allowed_hosts: decision.dynamic_allowed_hosts ?? [],
          dynamic_allowed_providers: decision.dynamic_allowed_providers ?? [],
          blocked_provider_host_pairs: decision.blocked_provider_host_pairs ?? [],
          dynamic_allowed_provider_host_bindings: decision.dynamic_allowed_provider_host_bindings ?? [],
          allowed_provider_host_bindings: decision.allowed_provider_host_bindings ?? environmentPolicy.egressAllowlist.providerHostBindings,
          requested_paths: decision.requested_paths ?? [],
          blocked_paths: decision.blocked_paths ?? [],
          allowed_paths: decision.allowed_paths ?? environmentPolicy.allowedPaths,
          execution_constraints: definition.execution_constraints ?? {},
          environment_policy: environmentPolicy,
        },
      });
    }

    const rawResult = await handler(request, {
      ...context,
      execution_environment: name,
      execution_policy: environmentPolicy,
    });
    const sanitizedResult = prepareOutput(rawResult);

    return {
      ...sanitizedResult,
        metrics: {
          ...(sanitizedResult.metrics ?? {}),
          environment: name,
          restricted: true,
          approved: Boolean(context.approved),
          network_intent_source: decision.network_intent_source ?? 'none',
          requested_network_intent: decision.requested_network_intent ?? null,
          requested_hosts: decision.requested_hosts ?? [],
          requested_providers: decision.requested_providers ?? [],
          requested_urls: decision.requested_urls ?? [],
          requested_targets: decision.requested_targets ?? [],
          blocked_hosts: decision.blocked_hosts ?? [],
          blocked_providers: decision.blocked_providers ?? [],
          allowed_hosts: decision.allowed_hosts ?? environmentPolicy.egressAllowlist.hosts,
          allowed_providers: decision.allowed_providers ?? environmentPolicy.egressAllowlist.providers,
          dynamic_allowed_hosts: decision.dynamic_allowed_hosts ?? [],
          dynamic_allowed_providers: decision.dynamic_allowed_providers ?? [],
          blocked_provider_host_pairs: decision.blocked_provider_host_pairs ?? [],
          dynamic_allowed_provider_host_bindings: decision.dynamic_allowed_provider_host_bindings ?? [],
          allowed_provider_host_bindings: decision.allowed_provider_host_bindings ?? environmentPolicy.egressAllowlist.providerHostBindings,
          execution_constraints: definition.execution_constraints ?? {},
          environment_policy: environmentPolicy,
        },
      };
  }

  return {
    name,
    canExecute,
    prepareInput,
    prepareOutput,
    execute,
  };
}
