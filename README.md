# Self-Healing AI — Agentic API Contract Demo

A demonstration of AI-driven agentic loops that automatically propagate schema changes across a multi-project stack. When you modify the database schema, the system cascades updates through the API layer and into the UI — with developer approval at each step.

## How It Works

The system simulates three independent development teams sharing a data contract:

```
database-project/schema.json
        │
        ▼
  API Agentic Loop ──► api-project/swagger.json
                              │
                              ▼
                        UI Agentic Loop ──► ui-project/components/PersonTable.tsx
```

1. **Database Team** modifies `schema.json` (adds/removes a field)
2. **API Agentic Loop** detects the change, calls an LLM to regenerate routes and Swagger spec, then asks the developer for approval
3. **UI Agentic Loop** detects the Swagger change, calls an LLM to update the React component, then asks the developer for approval

Each loop watches for file changes, generates code via an LLM, and prompts for human approval before applying updates.

## Project Structure

```
├── database-project/     # NeDB database with schema definition
│   ├── schema.json       # Source of truth for data shape
│   ├── db.js             # Database access layer
│   └── seed.js           # Seeds sample data
├── api-project/          # Express REST API
│   ├── server.js         # API server
│   ├── routes/           # Generated route handlers
│   ├── swagger.json      # Generated OpenAPI spec
│   ├── agentic-loop.js   # Watches schema.json, regenerates API
│   └── self-heal.js      # Orchestrates LLM-driven code updates
├── ui-project/           # Next.js React UI
│   ├── components/       # Generated table component
│   ├── app/              # Next.js app directory
│   ├── agentic-loop.js   # Watches swagger.json, regenerates UI
│   └── self-heal.js      # Orchestrates LLM-driven code updates
├── shared/               # Shared utilities
│   ├── llm-client.js     # OpenAI-compatible LLM client
│   ├── file-watcher.js   # File change detection (chokidar)
│   ├── notifier.js       # macOS notifications
│   └── diff-schema.js    # Schema diffing utilities
├── scripts/              # Helper scripts
│   ├── start-demo.js     # Starts all services
│   ├── add-field.js      # Adds a field to schema + generates data
│   └── remove-field.js   # Removes a field from schema + data
└── tests/                # Integration tests
```

## Prerequisites

- **Node.js** >= 18
- **An OpenAI-compatible LLM server** (e.g., [MLX-LM](https://github.com/ml-explore/mlx-lm), [Ollama](https://ollama.com), [vLLM](https://github.com/vllm-project/vllm))

## Setup

```bash
# Clone and install dependencies
git clone <repo-url>
cd selfHealingAI
npm install

# Configure environment
cp .env.example .env
# Edit .env with your LLM server address and model name

# Seed the database with sample data
npm run --workspace=database-project seed
```

## Running the Demo

```bash
# Start the agentic loops (watches for changes)
npm run demo

# In a separate terminal, start the API server
npm run start:api

# In a separate terminal, start the Next.js UI
cd ui-project && npm run dev
```

### Triggering a Cascade

Add a field to the schema:

```bash
# Adds a field and generates sample data via LLM
node scripts/add-field.js date_of_birth string
node scripts/add-field.js age number
```

Remove a field:

```bash
node scripts/remove-field.js date_of_birth
```

After a schema change, the agentic loops will:
1. Detect the file change
2. Generate updated code via the LLM
3. Display a diff and prompt for approval in the terminal
4. Apply the update (or skip if denied)

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_ENDPOINT` | `http://localhost:8080/v1/chat/completions` | OpenAI-compatible completions URL |
| `LLM_MODEL` | `default` | Model name to pass to the LLM server |
| `PORT` | `3000` | API server port |

## Running Tests

```bash
# Run all tests (unit + property-based)
npm test

# Run UI tests only
npm test --workspace=ui-project
```

## License

ISC
