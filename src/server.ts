/**
 * @blankstate/mcp - MCP Server Implementation
 * 
 * Exposes Blankstate Protocol sensing as MCP tools that any
 * MCP-compatible agent (Cursor, Claude Desktop, etc.) can call.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolWrapper, createToolWrapper } from './tools/wrapper.js';
import { IBFClient } from './api/ibfClient.js';
import { loadConfig } from './config/schema.js';
import type { BlankstateConfig, BlockedResult } from './types/index.js';
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const LIVE_DIR = join(homedir(), '.blankstate', 'live');
const EVENTS_FILE = join(LIVE_DIR, 'events.jsonl');

function emitLiveEvent(event: Record<string, unknown>): void {
  try {
    if (!existsSync(LIVE_DIR)) mkdirSync(LIVE_DIR, { recursive: true });
    appendFileSync(EVENTS_FILE, JSON.stringify({ ...event, ts: Date.now() }) + '\n');
  } catch { /* non-critical — monitor may not be running */ }
}

// ============================================================================
// Built-in tool definitions
// ============================================================================

const BUILTIN_TOOLS: Tool[] = [
  {
    name: 'bks_sense',
    description:
      'Measure any content against a Blankstate Protocol or Metric. ' +
      'Protocols are universal sensors — they measure interactions regardless of content type ' +
      '(conversation transcripts, commands, documents, agent actions, emails). ' +
      'Returns a score, per-metamarker resonance, glass-box evidence, and fidelity. ' +
      'When sensing against a Metric, multiple protocols are evaluated and scores are aggregated with weights.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'The content to measure. Can be any text: a conversation, a command, a document, an agent action.',
        },
        protocol_id: {
          type: 'string',
          description:
            'Protocol ID with version (e.g., "proto-xxx:1.0"). ' +
            'If omitted and no metric_id is provided, uses the first configured protocol.',
        },
        metric_id: {
          type: 'string',
          description:
            'Metric ID to evaluate against (e.g., "agent-safety-score"). ' +
            'Metrics combine multiple protocols with weights into a single aggregated score. ' +
            'If omitted, uses the first configured metric (if any) or falls back to protocol_id.',
        },
        language: {
          type: 'string',
          description: 'Language of the content (ISO 639-1). Defaults to "en".',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'bks_validate',
    description:
      'Validate a proposed agent action against all configured Protocols and Metrics. ' +
      'Extracts content from the action arguments and evaluates it. ' +
      'Returns ALLOWED, BLOCKED (with evidence), or FEEDBACK depending on the configured mode. ' +
      'Use this before executing potentially risky operations (commands, file writes, messages).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tool_name: {
          type: 'string',
          description: 'The tool/action being validated (e.g., "execute_command", "file_write", "send_email").',
        },
        tool_args: {
          type: 'object',
          description: 'The arguments that would be passed to the tool.',
          additionalProperties: true,
        },
      },
      required: ['tool_name', 'tool_args'],
    },
  },
  {
    name: 'bks_status',
    description:
      'Check Blankstate API connectivity, authentication, ICS (Interaction Computed Signals) ' +
      'credits remaining, and list configured protocols and metrics.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

/**
 * Blankstate MCP Server
 * 
 * Exposes bks_sense, bks_validate, and bks_status as MCP tools.
 */
export class BlankstateMCPServer {
  private readonly server: Server;
  private readonly config: BlankstateConfig;
  private readonly wrapper: ToolWrapper;
  private readonly ibf: IBFClient;

  constructor(config?: BlankstateConfig) {
    this.config = config ?? loadConfig();
    this.wrapper = createToolWrapper(this.config);
    this.ibf = new IBFClient(this.config.apiToken, this.config.apiUrl);

    this.server = new Server(
      {
        name: '@blankstate/mcp',
        version: '0.3.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: BUILTIN_TOOLS };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      return this.handleToolCall(name, args ?? {});
    });
  }

  private async handleToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<CallToolResult> {
    console.error(`[blankstate] Tool call: ${toolName}`);

    try {
      switch (toolName) {
        case 'bks_sense':
          return await this.handleSense(args);
        case 'bks_validate':
          return await this.handleValidate(args);
        case 'bks_status':
          return await this.handleStatus();
        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
            isError: true,
          };
      }
    } catch (error) {
      console.error(`[blankstate] Error in ${toolName}:`, error);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
            tool: toolName,
          }),
        }],
        isError: true,
      };
    }
  }

  // ── bks_sense ──────────────────────────────────────────────────────────

  private async handleSense(args: Record<string, unknown>): Promise<CallToolResult> {
    const content = args.content as string;
    if (!content || typeof content !== 'string') {
      return {
        content: [{ type: 'text', text: 'Error: "content" (string) is required.' }],
        isError: true,
      };
    }

    const language = (args.language as string) ?? 'en';
    const metricId = args.metric_id as string | undefined;
    const protocolId = args.protocol_id as string | undefined;

    // If metric_id is provided or configured, evaluate via metric (multi-protocol aggregation)
    const targetMetric = metricId
      ? this.config.metrics.find(m => m.id === metricId)
      : (!protocolId && this.config.metrics.length > 0 ? this.config.metrics[0] : undefined);

    if (targetMetric) {
      return this.handleSenseMetric(targetMetric, content, language);
    }

    // Otherwise evaluate against a single protocol
    const targetProtocolId = protocolId ?? this.config.protocols[0]?.id;
    if (!targetProtocolId) {
      return {
        content: [{ type: 'text', text: 'Error: No protocol or metric configured. Set BLANKSTATE_PROTOCOLS or BLANKSTATE_METRICS.' }],
        isError: true,
      };
    }

    const response = await this.ibf.senseSingle(targetProtocolId, content, language);
    emitLiveEvent({
      type: 'sense', source: 'mcp', protocolId: targetProtocolId,
      score: response.score, resonance: response.resonance,
      actant_flow: response.actant_flow,
      entities: (response as any).v15?.entities?.resolved,
    });
    return { content: [{ type: 'text', text: this.formatSenseResponse(targetProtocolId, response) }] };
  }

  private async handleSenseMetric(
    metric: import('./types/index.js').MetricConfig,
    content: string,
    language: string
  ): Promise<CallToolResult> {
    if (!metric.protocols || metric.protocols.length === 0) {
      return {
        content: [{ type: 'text', text: `Error: Metric "${metric.id}" has no protocols defined.` }],
        isError: true,
      };
    }

    const protocolIds = metric.protocols.map(p => p.id);
    const responses = await this.ibf.senseMultiple(content, protocolIds, language);

    const lines: string[] = [
      `Metric: ${metric.id}${metric.name ? ` (${metric.name})` : ''}`,
      `Aggregation: ${metric.calculationMethod ?? 'weighted_average'}`,
      '',
    ];

    let weightedSum = 0;
    let totalWeight = 0;
    let totalIcs = 0;

    for (const pRef of metric.protocols) {
      const resp = responses.get(pRef.id);
      if (!resp) continue;

      const score = resp.score ?? 0;
      weightedSum += score * pRef.weight;
      totalWeight += pRef.weight;
      totalIcs += resp.ics?.consumed ?? 0;

      lines.push(`Protocol: ${pRef.id} (weight: ${pRef.weight})`);
      lines.push(`  Score: ${score.toFixed(4)}`);
      lines.push(`  Fidelity: ${resp.fidelity.index.toFixed(4)} (sufficient: ${resp.fidelity.sufficient})`);

      const resonance = Object.entries(resp.resonance)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([marker, s]) => `    ${marker}: ${(s as number).toFixed(4)}`)
        .join('\n');
      if (resonance) {
        lines.push(`  Top Resonance:`);
        lines.push(resonance);
      }
      lines.push('');
    }

    const aggregated = totalWeight > 0 ? weightedSum / totalWeight : 0;
    lines.push(`Aggregated Score: ${aggregated.toFixed(4)}`);
    lines.push(`Threshold: ${metric.threshold} — ${aggregated >= metric.threshold ? 'TRIGGERED' : 'below threshold'}`);
    lines.push(`Total ICS consumed: ${totalIcs}`);

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  private formatSenseResponse(protocolId: string, response: import('./types/index.js').IBFSenseResponse): string {
    const resonanceEntries = Object.entries(response.resonance ?? {})
      .filter(([, s]) => s != null)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .map(([marker, score]) => `  ${marker}: ${(score as number).toFixed(4)}`)
      .join('\n');

    const evidenceLines = (response.evidence ?? [])
      .filter(e => e.score != null && e.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(e => {
        const actant = e.actant ? ` [actant:${e.actant}]` : '';
        return `  [${e.score.toFixed(3)}]${actant} ${e.metamarker}`;
      })
      .join('\n');

    const score = response.score ?? 0;
    const fidelityIndex = response.fidelity?.index ?? 0;
    const fidelitySufficient = response.fidelity?.sufficient ?? false;

    const lines = [
      `Protocol: ${protocolId}`,
      `SGM version: ${response.ics?.sgm_version ?? '1.0'}`,
      `Score: ${score.toFixed(4)}`,
      `Fidelity: ${fidelityIndex.toFixed(4)} (sufficient: ${fidelitySufficient})`,
    ];

    if (response.fidelity?.density != null) {
      lines.push(`Fidelity density: ${response.fidelity.density.toFixed(4)}`);
    }
    if (response.fidelity?.clarity != null) {
      lines.push(`Fidelity clarity: ${response.fidelity.clarity.toFixed(4)}`);
    }

    // C×B×I aggregate (v1.5)
    const v15 = response.v15;
    if (v15?.cxbi_aggregate) {
      const cx = v15.cxbi_aggregate;
      const parts = Object.entries(cx).map(([k, v]) => `${k}=${(v as number).toFixed(2)}`).join(', ');
      lines.push(`CxBxI: ${parts}`);
    }

    lines.push('', 'Resonance:');
    lines.push(resonanceEntries || '  (none)');

    lines.push('', 'Top Evidence:');
    lines.push(evidenceLines || '  (none)');

    // Signal analysis
    if (response.signal) {
      lines.push('', 'Signal (SGM 1.5):');
      lines.push(`  Coherence: ${response.signal.coherence.toFixed(4)}`);
      lines.push(`  Dominant mode: ${response.signal.dominant_mode}`);
    }

    // Actant flow
    if (response.actant_flow) {
      lines.push('', 'Actant Flow (SGM 1.5):');
      lines.push(`  Direction: ${response.actant_flow.direction}`);
      lines.push(`  Balance: ${response.actant_flow.balance.toFixed(4)}`);
      if (response.actant_flow.primary_driven.length > 0) {
        lines.push(`  Primary driven: ${response.actant_flow.primary_driven.join(', ')}`);
      }
      if (response.actant_flow.secondary_driven.length > 0) {
        lines.push(`  Secondary driven: ${response.actant_flow.secondary_driven.join(', ')}`);
      }
    }

    // Entities / Actants (v1.5)
    if (v15?.entities && v15.entities.resolved?.length > 0) {
      lines.push('', `Entities (${v15.entities.totalResolved} resolved, ${v15.entities.actantCount} actants):`);
      for (const ent of v15.entities.resolved.slice(0, 8)) {
        const role = ent.isActant ? 'actant' : 'entity';
        lines.push(`  ${ent.canonicalName} [${ent.entityType}/${role}] — ${ent.totalMentions} mentions`);
      }
    }

    // Segmentation (v1.5)
    if (v15?.segmentation) {
      const seg = v15.segmentation;
      const speakers = seg.speakersFound?.length ? seg.speakersFound.join(', ') : 'none';
      lines.push('', `Segmentation: ${seg.numSegments} segments, mode=${seg.detectedMode}, speakers=[${speakers}]`);
    }

    // Temporal dynamics
    if (response.temporal) {
      lines.push('', 'Temporal (SGM 1.5):');
      lines.push(`  Trend: ${response.temporal.trend}`);
      lines.push(`  Phase shifts: ${response.temporal.phase_shifts}`);
    }

    lines.push('');
    lines.push(`ICS consumed: ${response.ics?.consumed ?? 0}`);
    if (response.ics?.pool) {
      lines.push(`ICS pool: ${response.ics.pool.used}/${response.ics.pool.quota} used, ${response.ics.pool.remaining} remaining`);
    }

    return lines.join('\n');
  }

  // ── bks_validate ───────────────────────────────────────────────────────

  private async handleValidate(args: Record<string, unknown>): Promise<CallToolResult> {
    const toolName = args.tool_name as string;
    const toolArgs = args.tool_args;

    if (!toolName || typeof toolName !== 'string') {
      return {
        content: [{ type: 'text', text: 'Error: "tool_name" (string) is required.' }],
        isError: true,
      };
    }

    const result = await this.wrapper.wrapToolCall(toolName, toolArgs);

    if (result.blocked && result.result) {
      emitLiveEvent({
        type: 'validate', source: 'mcp', toolName,
        status: 'BLOCKED', score: result.result.score,
        protocolId: result.result.source,
      });
      return this.formatBlockedResult(result.result);
    }

    emitLiveEvent({
      type: 'validate', source: 'mcp', toolName, status: 'ALLOWED',
    });

    const lines = [
      `Action: ${toolName}`,
      `Status: ALLOWED`,
    ];

    if (this.config.protocols.length > 0) {
      lines.push(`Protocols checked: ${this.config.protocols.map(p => p.id).join(', ')}`);
    }
    if (this.config.metrics.length > 0) {
      lines.push(`Metrics checked: ${this.config.metrics.map(m => m.id).join(', ')}`);
    }

    if (result.feedback && result.feedback.length > 0) {
      lines.push('', 'Feedback:');
      for (const f of result.feedback) {
        lines.push(`  [${f.sourceType}] ${f.source} (score: ${f.score.toFixed(3)}): ${f.suggestions.join(', ')}`);
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  // ── bks_status ─────────────────────────────────────────────────────────

  private async handleStatus(): Promise<CallToolResult> {
    const status = await this.ibf.status();

    const lines = [
      `API: ${status.status}`,
      `Authenticated: ${status.authenticated}`,
      `SGM versions: ${Object.entries(status.sgm_versions).map(([v, s]) => `${v} (${s})`).join(', ')}`,
      `Profiles: ${status.profiles.join(', ')}`,
    ];

    if (status.ics) {
      lines.push(`ICS remaining: ${status.ics.remaining} (period: ${status.ics.period})`);
    }

    lines.push('', 'Configured protocols:');
    for (const p of this.config.protocols) {
      lines.push(`  ${p.id} — mode: ${p.mode}, threshold: ${p.threshold}`);
    }

    if (this.config.metrics.length > 0) {
      lines.push('', 'Configured metrics:');
      for (const m of this.config.metrics) {
        lines.push(`  ${m.id} — mode: ${m.mode}, threshold: ${m.threshold}`);
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  // ── Shared formatting ──────────────────────────────────────────────────

  private formatBlockedResult(blocked: BlockedResult): CallToolResult {
    return {
      content: [
        {
          type: 'text',
          text: [
            `[BLANKSTATE] Action Blocked`,
            ``,
            `Source: ${blocked.source}`,
            `Score: ${blocked.score.toFixed(4)}`,
            `Nuances Matched: ${blocked.nuances.join(', ')}`,
            blocked.evidence?.length ? `Evidence: ${blocked.evidence.join('; ')}` : '',
            ``,
            `Message: ${blocked.message}`,
            ``,
            `The requested action has been suspended for safety review.`,
            `To proceed, modify your request to avoid the detected patterns.`,
          ].filter(Boolean).join('\n'),
        },
      ],
      isError: true,
    };
  }

  async start(): Promise<void> {
    console.error('[blankstate] Starting MCP server...');
    console.error(`[blankstate] Configured Protocols: ${this.config.protocols.map(p => p.id).join(', ')}`);
    console.error(`[blankstate] API URL: ${this.config.apiUrl}`);
    console.error(`[blankstate] Tools: ${BUILTIN_TOOLS.map(t => t.name).join(', ')}`);

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error('[blankstate] MCP server running');
  }

  async stop(): Promise<void> {
    console.error('[blankstate] Stopping MCP server...');
    await this.server.close();
    console.error('[blankstate] MCP server stopped');
  }
}

/**
 * Create and start the MCP server
 */
export async function startServer(config?: BlankstateConfig): Promise<BlankstateMCPServer> {
  const server = new BlankstateMCPServer(config);
  await server.start();
  return server;
}
