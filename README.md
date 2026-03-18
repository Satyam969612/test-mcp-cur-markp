# @blankstate/mcp

**Protocol-based sensing and validation for autonomous AI agents.**

The Blankstate MCP Server exposes Blankstate measurement as MCP tools.
It lets any MCP-compatible agent (Cursor, Claude Desktop, and others) sense interactions against
Blankstate Protocols, validate actions before executing them, and check quota status.

Protocols are **universal sensors** — the same protocol measures any content modality:
conversations, commands, documents, agent actions. The measurement engine determines signal,
not the input type.

## Features

- **Three MCP tools**: `bks_sense`, `bks_validate`, `bks_status`
- **Protocol and Metric support**: Sense against a single Protocol or a Metric that aggregates multiple Protocols with weights
- **SGM 1.0 and 1.5**: Full output for both engine versions (resonance, evidence, and extended analysis in v1.5)
- **Three modes**: `block` (reject action), `feedback` (allow + suggest), `audit` (log only)
- **Zero config for simple cases**: Just set `BLANKSTATE_API_TOKEN` and `BLANKSTATE_PROTOCOLS`
- **Drop-in integration**: Works with any MCP-compatible agent

## Quick Start

### 1. Get an API Token

Sign up at [atlas.blankstate.ai](https://atlas.blankstate.ai) and generate an API token.
Find your Protocol ID at **API Dashboard → Explorer → /protocols**.

### 2. Add to Your Agent Configuration

**Mac / Linux:**

```json
{
  "mcpServers": {
    "blankstate": {
      "command": "npx",
      "args": ["-y", "@blankstate/mcp"],
      "env": {
        "BLANKSTATE_API_TOKEN": "your-token-here",
        "BLANKSTATE_PROTOCOLS": "proto-xxxxxxxx-...:1.0"
      }
    }
  }
}
```

**Windows (Cursor / Claude Desktop):**

```json
{
  "mcpServers": {
    "blankstate": {
      "command": "npx.cmd",
      "args": ["-y", "@blankstate/mcp"],
      "env": {
        "BLANKSTATE_API_TOKEN": "your-token-here",
        "BLANKSTATE_PROTOCOLS": "proto-xxxxxxxx-...:1.0"
      }
    }
  }
}
```

> **Important**: Use the actual Protocol UUID from Atlas (e.g. `proto-6d28a7b8-...:0.1`),
> not a friendly name. Find yours at Atlas → API Dashboard → Explorer → `/protocols`.

### 3. Done

Your agent now has access to three Blankstate tools.

## MCP Tools

Once connected, your agent has three tools:

### `bks_sense`

Measure any content against a Protocol or Metric. Returns a resonance score, per-metamarker
breakdown, glass-box evidence, and fidelity assessment.

```
Input: content (required), protocol_id?, metric_id?, language?
```

Protocols are universal — they measure conversations, commands, documents, and agent
actions the same way. v1.5 protocols provide extended signal analysis output.

When `metric_id` is provided, all component protocols are evaluated and scores are
aggregated by weight into a single composite score.

### `bks_validate`

Validate a proposed agent action (before executing it) against all configured Protocols
and Metrics. The action arguments are content-extracted and evaluated.

```
Input: tool_name (required), tool_args (required)
```

Returns `ALLOWED`, `BLOCKED` (with evidence and matched nuances), or `FEEDBACK`
depending on the configured mode. In `block` mode a blocked action is returned as
an MCP error, stopping the agent from proceeding.

### `bks_status`

Check API connectivity, authentication, remaining ICS credits, and the full list of
configured Protocols and Metrics.

```
Input: (none)
```

## Installation

For most users, no installation is needed. MCP-compatible agents run the package directly via `npx @blankstate/mcp`.

If you want to install globally:

```bash
npm install -g @blankstate/mcp
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BLANKSTATE_API_TOKEN` | **Required.** Bearer token from Atlas | |
| `BLANKSTATE_PROTOCOLS` | Comma separated Protocol IDs | |
| `BLANKSTATE_METRICS` | Comma separated Metric IDs | |
| `BLANKSTATE_THRESHOLD` | Score threshold (0.0 to 1.0) | `0.7` |
| `BLANKSTATE_MODE` | `block`, `feedback`, or `audit` | `block` |

### Config File

For advanced configuration, create `~/.blankstate/config.json`:

```json
{
  "apiToken": "your-token-here",
  "defaultThreshold": 0.7,
  "defaultMode": "block",
  "protocols": [
    {
      "id": "circuit-breaker:1.0",
      "mode": "block",
      "threshold": 0.7,
      "tools": ["exec", "write"]
    },
    {
      "id": "code-quality:1.0",
      "mode": "feedback",
      "threshold": 0.5,
      "tools": ["write"]
    }
  ]
}
```

### Protocol Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `id` | `string` | Protocol ID with version (e.g., `circuit-breaker:1.0`) |
| `mode` | `block` \| `feedback` \| `audit` | How to handle triggered Protocols |
| `threshold` | `number` | Score threshold (0.0 to 1.0) for triggering the action |
| `tools` | `string[]` | Tool types this Protocol applies to |

### Metric Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `id` | `string` | Metric ID from Atlas |
| `mode` | `block` \| `feedback` \| `audit` | How to handle triggered Metrics |
| `threshold` | `number` | Score threshold (overrides Atlas default if set) |
| `tools` | `string[]` | Tool types this Metric applies to |

### Tool Types

| Type | Description |
|------|-------------|
| `exec` | Shell commands, terminal execution |
| `write` | File creation, modification, patches |
| `browser` | Web navigation, form submission |
| `messaging` | Email, Slack, Discord, etc. |
| `all` | All tool types (default) |

## Modes

### Block Mode (Default)

When a Protocol triggers above the threshold, the tool call is **rejected**:

```
[BLANKSTATE] Action Blocked

Protocol: circuit-breaker:1.0
Nuances Matched: scope_violation, destructive_pattern
Evidence: targeting home directory with recursive deletion

Message: Action blocked by Protocol circuit-breaker:1.0.
The requested action has been suspended for safety review.
```

### Feedback Mode

Tool call **executes**, but the agent receives improvement suggestions:

```json
{
  "result": { ... },
  "blankstate_feedback": [
    {
      "source": "code-quality:1.0",
      "score": 0.65,
      "suggestions": ["missing_error_handling", "no_input_validation"]
    }
  ]
}
```

Use feedback mode to help agents write better code or follow best practices.

### Audit Mode

Tool call **executes** and evaluations are logged for compliance tracking:

```json
{
  "result": { ... },
  "blankstate_audit": [
    {
      "timestamp": "2026-01-31T12:00:00Z",
      "tool": "execute_command",
      "source": "compliance-check:1.0",
      "score": 0.3,
      "action": "allowed"
    }
  ]
}
```

## Available Protocols

Browse available Protocols and their capabilities at [doc.blankstate.ai/protocol-versions](https://doc.blankstate.ai/protocol-versions).

### Circuit Breaker (circuit-breaker:1.0)

Designed for autonomous agent safety. Detects scope violations, destructive patterns, credential exposure, and risky communication patterns.

### Custom Protocols

Create your own Protocols in [Atlas](https://atlas.blankstate.ai) and reference by ID:

```json
{
  "protocols": [
    { "id": "my-org/custom-policy:1.0", "mode": "block" }
  ]
}
```

## Metrics

Metrics aggregate multiple Protocols into a single weighted score. Metrics are defined in Atlas and referenced by ID:

```json
{
  "metrics": [
    {
      "id": "agent-safety-score",
      "mode": "block",
      "threshold": 0.7
    }
  ]
}
```

The protocol weights and composition are managed in Atlas. The threshold here is optional and overrides the Atlas default if you need different behavior for MCP.

Use Metrics when you want to combine multiple Protocols with weights, or when you need a pre configured safety suite.

## Programmatic Usage

You can also use the MCP server programmatically:

```typescript
import { BlankstateMCPServer, loadConfig } from '@blankstate/mcp';

const config = loadConfig();
const server = new BlankstateMCPServer(config);

await server.start();
```

Or use the tool wrapper directly:

```typescript
import { createToolWrapper, loadConfig } from '@blankstate/mcp';

const config = loadConfig();
const wrapper = createToolWrapper(config);

// Before executing a tool
const result = await wrapper.wrapToolCall('execute_command', {
  command: 'rm -rf ~/',
});

if (result.blocked) {
  console.error('Blocked:', result.result?.message);
} else {
  // Proceed with execution
}
```

## Integration Examples

### MCP Compatible Agents

Any agent that supports the Model Context Protocol can use Blankstate. Add to your agent's MCP configuration file:

```json
{
  "mcpServers": {
    "blankstate": {
      "command": "npx",
      "args": ["-y", "@blankstate/mcp"],
      "env": {
        "BLANKSTATE_API_TOKEN": "your-token",
        "BLANKSTATE_PROTOCOLS": "circuit-breaker:1.0"
      }
    }
  }
}
```

The exact config file location depends on your agent. Common locations:

- `~/.config/<agent>/config.json`
- `~/<agent>/settings.json`

### Direct API Integration

For agents without MCP support, you can call the Blankstate API directly. See the [API documentation](https://doc.blankstate.ai) for details.

## ICS Billing

Blankstate uses **ICS (Interaction Computed Signal)** billing:

- **ICS consumed only on detection**: no charge for tool calls that pass validation
- **Usage tracked** per API token in the Atlas dashboard
- **Credits managed** in Atlas: individual accounts receive monthly free credits

This means you can monitor thousands of tool calls and only pay when something is caught. Pricing and credit allocation are configured in your [Atlas account](https://atlas.blankstate.ai).

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      YOUR MACHINE                                │
│                                                                  │
│  ┌────────────────┐         ┌──────────────────────────────┐    │
│  │   Agent        │  MCP    │   @blankstate/mcp            │    │
│  │   (Any MCP     │ ──────> │                              │    │
│  │   compatible   │         │  Intercepts tool calls       │    │
│  │   agent)       │         │  Calls configured Protocols  │    │
│  └────────────────┘         │  Applies mode decisions      │    │
│                             └──────────────┬───────────────┘    │
│                                            │                     │
└────────────────────────────────────────────┼─────────────────────┘
                                             │
                                             │ HTTPS + Bearer Token
                                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    BLANKSTATE CLOUD                              │
│                                                                  │
│   Protocol evaluation (pure sensors)                             │
│   Returns score, nuances, evidence                               │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Contributing

```bash
git clone https://github.com/blankstate-ai/blankstate-node.git
cd blankstate-node
npm install
npm run build
```

## Troubleshooting

### Issue in Cursor / Claude Desktop (Windows)

On Windows, `npx` is `npx.cmd` and requires an explicit extension when spawned directly.
Use `"command": "npx.cmd"` instead of `"command": "npx"` in your MCP config.

### "Missing API token"

Set `BLANKSTATE_API_TOKEN` in the `env` block of your MCP config, or in `~/.blankstate/config.json`.

### "No Protocols or Metrics configured"

Set `BLANKSTATE_PROTOCOLS` or `BLANKSTATE_METRICS` in the `env` block:

```json
"BLANKSTATE_PROTOCOLS": "proto-xxxxxxxx-...:1.0"
```

Both can be set at the same time. Protocols are evaluated directly; Metrics aggregate multiple protocols.

### Protocol ID format

Use the UUID-based ID from Atlas (e.g. `proto-6d....:0.2`),
not a friendly name. Find your Protocol ID at Atlas → API Dashboard → Explorer → `/protocols`.

### "API request failed: 401"

Token is invalid or expired. Generate a new one at [atlas.blankstate.ai](https://atlas.blankstate.ai).

### "API request failed: 404"

Protocol not found. Verify the ID and version exist in your Atlas account.

## Links

- [Blankstate](https://blankstate.ai)
- [Atlas Dashboard](https://atlas.blankstate.ai)
- [API Reference](https://api.blankstate.ai/docs)
- [GitHub Issues](https://github.com/blankstate-ai/blankstate-node/issues)

## License

MIT License. See [LICENSE](LICENSE) for details.

