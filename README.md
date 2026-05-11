# ToukeAgent

## Development

```bash
npm test
npm run dev
```

## Model Keys

Use a dedicated local config file for model keys:

```bash
cp config/model-config.example.json config/model-config.local.json
```

Fill in `config/model-config.local.json`, especially `deepseek.apiKey`.

The app reads the local config first and falls back to environment variables for compatibility.

## Workflow

- OpenSpec defines scope and acceptance.
- `AGENTS.md` defines the Codex workflow.
- Git records each meaningful implementation step.
