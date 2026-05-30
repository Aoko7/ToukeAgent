import { createPersonaProfile } from '../../../packages/contracts/src/index.mjs';
import { callPythonCore } from './python-core-bridge.mjs';

export function createPersonaRegistry(personas = null) {
  const catalog = callPythonCore('describe_persona_catalog', {
    personas: Array.isArray(personas) && personas.length > 0 ? personas : null,
  });
  const resolved = (catalog.personas ?? []).map((persona) => createPersonaProfile(persona));
  const map = new Map(resolved.map((persona) => [persona.persona_id, persona]));
  const toolsets = Array.isArray(catalog.toolsets) ? structuredClone(catalog.toolsets) : [];

  return {
    get(personaId = 'researcher') {
      const persona = map.get(personaId);
      if (persona) {
        return persona;
      }

      return createPersonaProfile(callPythonCore('resolve_persona', {
        persona_id: personaId,
        personas: Array.from(map.values()),
        packs: catalog.packs ?? [],
      }));
    },
    list() {
      return Array.from(map.values());
    },
    packs() {
      return Array.isArray(catalog.packs) ? structuredClone(catalog.packs) : [];
    },
    toolsets() {
      return structuredClone(toolsets);
    },
    catalog() {
      return {
        default_persona_id: catalog.default_persona_id ?? 'researcher',
        packs: Array.isArray(catalog.packs) ? structuredClone(catalog.packs) : [],
        personas: Array.from(map.values()),
        toolsets: structuredClone(toolsets),
      };
    },
  };
}
