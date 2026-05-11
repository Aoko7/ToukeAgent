export function createResponseComposer({ client } = {}) {
  function localCompose({ persona, plan, retrievalResult, message, memorySnapshot }) {
    const text = message.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim();

    const sourceTitles = retrievalResult?.result?.items?.map((item) => `${item.title} (${item.source_type ?? 'context'})`).join(', ') ?? 'internal stable context';
    const routeMode = retrievalResult?.result?.route?.mode ?? 'rag-first';
    const shortTerm = memorySnapshot?.short_term?.map((entry) => entry.summary ?? entry.title).filter(Boolean).join(' | ') ?? 'none';
    const longTerm = memorySnapshot?.long_term?.map((entry) => entry.title).filter(Boolean).join(' | ') ?? 'none';
    return [
      `[${persona.name}]`,
      `Goal: ${plan.goal}`,
      `Plan: ${plan.steps.map((step, index) => `${index + 1}. ${step.title}`).join(' | ')}`,
      `Retrieval route: ${routeMode}`,
      `Context: ${sourceTitles}`,
      `Short-term memory: ${shortTerm}`,
      `Long-term memory: ${longTerm}`,
      `Next move: start from the smallest verified slice for "${text}".`,
    ].join('\n');
  }

  return {
    async compose({ persona, message, plan, retrievalResult, memorySnapshot }) {
      if (!client?.isConfigured) {
        return localCompose({ persona, message, plan, retrievalResult, memorySnapshot });
      }

      const sourceTitles = retrievalResult?.result?.items?.map((item) => `${item.title} (${item.source_type ?? 'context'})`).join(', ') ?? 'internal stable context';
      const routeMode = retrievalResult?.result?.route?.mode ?? 'rag-first';
      const shortTerm = memorySnapshot?.short_term?.map((entry) => entry.summary ?? entry.title).filter(Boolean).join(' | ') ?? 'none';
      const longTerm = memorySnapshot?.long_term?.map((entry) => entry.title).filter(Boolean).join(' | ') ?? 'none';
      const userText = message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .trim();

      const completion = await client.chat({
        messages: [
          {
            role: 'system',
            content: [
              `You are ${persona.name}.`,
              `Follow the persona purpose: ${persona.purpose}.`,
              `Respond in the user's language, be concise, and preserve the plan trace.`,
              `Use the retrieved stable context only when relevant.`,
              `Return a short actionable response that references the plan.`,
            ].join(' '),
          },
          {
            role: 'user',
            content: [
              `User request: ${userText}`,
              `Goal: ${plan.goal}`,
              `Plan: ${plan.steps.map((step, index) => `${index + 1}. ${step.title}`).join(' | ')}`,
              `Retrieval route: ${routeMode}`,
              `Context: ${sourceTitles}`,
              `Short-term memory: ${shortTerm}`,
              `Long-term memory: ${longTerm}`,
            ].join('\n'),
          },
        ],
        thinking: { type: 'enabled' },
        reasoningEffort: 'medium',
        maxTokens: 1024,
      });

      return completion.content?.trim() || localCompose({ persona, message, plan, retrievalResult, memorySnapshot });
    },
  };
}
