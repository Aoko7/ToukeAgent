# ToukeAgent

## Development

```bash
npm test
npm run dev
```

## DeepSeek

Set these environment variables before starting the server:

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL` (default: `https://api.deepseek.com`)
- `DEEPSEEK_MODEL` (default: `deepseek-v4-flash`)

You can start from:

```bash
cp .env.example .env
```

## Workflow

- OpenSpec defines scope and acceptance.
- `AGENTS.md` defines the Codex workflow.
- Git records each meaningful implementation step.
