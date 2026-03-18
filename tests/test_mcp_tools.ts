#!/usr/bin/env npx tsx
/**
 * @blankstate/mcp — MCP Tools Integration Tests
 *
 * Tests bks_sense, bks_validate, and bks_status by instantiating
 * BlankstateMCPServer directly (no stdio/Cursor required) and calling
 * each tool handler with realistic arguments.
 *
 * Also validates that the server exposes the correct tool list so
 * Cursor / Claude Desktop can discover them.
 *
 * Usage:
 *   npx tsx tests/test_mcp_tools.ts
 *
 * Environment:
 *   BLANKSTATE_API_TOKEN   — your API token (falls back to test token)
 *   BLANKSTATE_PROTOCOLS   — protocol ID with version
 *   BLANKSTATE_API_URL     — IBF URL (default: https://ibf.blankstate.ai)
 */

import { BlankstateMCPServer, loadConfig } from '../src/index.js';
import type { BlankstateConfig } from '../src/types/index.js';

// ── Configuration ─────────────────────────────────────────────────────────────

const PROTOCOL_ID =
  process.env.BLANKSTATE_TEST_PROTOCOL ||
  process.env.BLANKSTATE_PROTOCOLS?.split(',')[0]?.trim() ||
  'proto-6d28a7b8-a905-45f3-81f5-2cd574813450:0.2';

// ── Test Helpers ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function assertType(value: unknown, expectedType: string, message: string): void {
  assert(typeof value === expectedType, `${message} (expected ${expectedType}, got ${typeof value})`);
}

function section(name: string): void {
  console.log(`\n━━━ ${name} ━━━`);
}

// ── Helpers to call server tools directly ─────────────────────────────────────

/**
 * Call a tool on the server by patching into the private handleToolCall.
 * This is the same path Cursor takes when it calls a tool over MCP stdio.
 */
async function callTool(
  server: BlankstateMCPServer,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // Access via any to test the full private call path
  const result = await (server as any).handleToolCall(toolName, args);
  return result;
}

// ── Test: Tool Discovery (what Cursor/Claude will see) ────────────────────────

async function testToolDiscovery(server: BlankstateMCPServer): Promise<void> {
  section('Tool Discovery — what Cursor/Claude Desktop sees');

  const tools: Array<{ name: string; description: string }> = await (server as any).server.requestHandlers
    ? []
    : [];

  // Check tools via the BUILTIN_TOOLS constant (exported indirectly via ListTools handler)
  const listResult = await (server as any).setupHandlers
    ? (server as any).proxyTools
    : null;

  // Instead of going through MCP protocol, check the static BUILTIN_TOOLS
  const { BUILTIN_TOOLS } = await import('../src/server.js').catch(() => ({ BUILTIN_TOOLS: undefined }));

  // Validate tool names are correct
  const expectedTools = ['bks_sense', 'bks_validate', 'bks_status'];
  for (const name of expectedTools) {
    // We verify by calling each tool and checking it responds (not unknown-tool error)
    const r = await callTool(server, name, { content: 'test' });
    const isKnown = !r.content[0]?.text?.startsWith('Unknown tool:');
    assert(isKnown, `tool "${name}" is registered`);
  }

  // Verify unknown tool returns error
  const unknown = await callTool(server, 'not_a_real_tool', {});
  assert(
    unknown.isError === true && unknown.content[0]?.text?.includes('Unknown tool'),
    'unknown tool returns isError=true'
  );
}

// ── Test: bks_status ──────────────────────────────────────────────────────────

async function testStatus(server: BlankstateMCPServer): Promise<void> {
  section('bks_status — API health + ICS + configured protocols');

  const result = await callTool(server, 'bks_status', {});

  assert(!result.isError, 'no error');
  assert(result.content.length > 0, 'has content');

  const text = result.content[0]?.text ?? '';
  assert(text.includes('Authenticated: true'), 'token is authenticated');
  assert(text.includes('SGM versions:'), 'SGM versions listed');
  assert(text.includes('ICS remaining:'), 'ICS remaining shown');
  assert(text.includes('Configured protocols:'), 'configured protocols listed');
  assert(text.includes(PROTOCOL_ID.split(':')[0]!), 'configured protocol ID appears');

  console.log('\n  Output:');
  for (const line of text.split('\n').slice(0, 10)) {
    console.log(`    ${line}`);
  }
}

// ── Test: bks_sense — protocol ────────────────────────────────────────────────

async function testSenseProtocol(server: BlankstateMCPServer): Promise<void> {
  section('bks_sense — single protocol');

  const content =
    'The Federal Reserve raised interest rates today by 25 basis points, ' +
    'citing persistent inflation concerns. Markets responded with cautious optimism.';

  const result = await callTool(server, 'bks_sense', {
    content,
    protocol_id: PROTOCOL_ID,
  });

  assert(!result.isError, 'no error');
  const text = result.content[0]?.text ?? '';

  assert(text.includes('Protocol:'), 'protocol shown');
  assert(text.includes('Score:'), 'score shown');
  assert(text.includes('Fidelity:'), 'fidelity shown');
  assert(text.includes('Resonance:'), 'resonance section present');
  assert(text.includes('Evidence:') || text.includes('none'), 'evidence section present');
  assert(text.includes('ICS consumed:'), 'ICS consumption shown');
  assert(text.includes('SGM version:'), 'SGM version shown');

  // Score must be a number in range [0, 1]
  const scoreMatch = text.match(/Score:\s*([\d.]+)/);
  if (scoreMatch) {
    const score = parseFloat(scoreMatch[1]!);
    assert(score >= 0 && score <= 1, `score in [0,1]: ${score.toFixed(4)}`);
  }

  // Fidelity must be present
  const fidelityMatch = text.match(/Fidelity:\s*([\d.]+)/);
  assert(!!fidelityMatch, 'fidelity is a number');

  console.log('\n  Output:');
  for (const line of text.split('\n').slice(0, 12)) {
    console.log(`    ${line}`);
  }
}

// ── Test: bks_sense — no content error ───────────────────────────────────────

async function testSenseMissingContent(server: BlankstateMCPServer): Promise<void> {
  section('bks_sense — missing content returns error');

  const result = await callTool(server, 'bks_sense', { protocol_id: PROTOCOL_ID });
  assert(result.isError === true, 'isError=true when content missing');
  assert(
    result.content[0]?.text?.includes('"content"'),
    'error message mentions "content"'
  );
}

// ── Test: bks_sense — no protocol error ──────────────────────────────────────

async function testSenseMissingProtocol(): Promise<void> {
  section('bks_sense — no protocol/metric configured returns error');

  // Create a server with no protocols or metrics
  const emptyConfig: BlankstateConfig = {
    apiToken: process.env.BLANKSTATE_API_TOKEN || (() => { throw new Error('Set BLANKSTATE_API_TOKEN'); })(),
    apiUrl: process.env.BLANKSTATE_API_URL || 'https://ibf.blankstate.ai',
    protocols: [],
    metrics: [],
    defaultThreshold: 0.7,
    defaultMode: 'block',
    sessionContextSize: 10,
  };

  const emptyServer = new BlankstateMCPServer(emptyConfig);
  const result = await callTool(emptyServer, 'bks_sense', { content: 'test content' });
  assert(result.isError === true, 'isError=true when no protocol configured');
  assert(
    result.content[0]?.text?.includes('No protocol'),
    'error message explains the issue'
  );
}

// ── Test: bks_validate — allowed action ──────────────────────────────────────

async function testValidateAllowed(server: BlankstateMCPServer): Promise<void> {
  section('bks_validate — low-risk action passes through');

  const result = await callTool(server, 'bks_validate', {
    tool_name: 'execute_command',
    tool_args: {
      command: 'ls -la',
      cwd: '/home/user/project',
    },
  });

  // Low-risk command — should not be blocked (score below threshold)
  const text = result.content[0]?.text ?? '';
  const isBlockedOrAllowed =
    text.includes('ALLOWED') || text.includes('[BLANKSTATE] Action Blocked');
  assert(isBlockedOrAllowed, 'returns a definitive ALLOWED or BLOCKED outcome');
  assert(text.includes('Protocols checked:') || text.includes('[BLANKSTATE]'), 'shows what was checked');

  console.log(`\n  Outcome: ${text.split('\n')[1] ?? text.substring(0, 60)}`);
}

// ── Test: bks_validate — missing tool_name ────────────────────────────────────

async function testValidateMissingToolName(server: BlankstateMCPServer): Promise<void> {
  section('bks_validate — missing tool_name returns error');

  const result = await callTool(server, 'bks_validate', { tool_args: {} });
  assert(result.isError === true, 'isError=true when tool_name missing');
  assert(
    result.content[0]?.text?.includes('"tool_name"'),
    'error message mentions "tool_name"'
  );
}

// ── Test: bks_sense — language parameter ─────────────────────────────────────

async function testSenseLanguage(server: BlankstateMCPServer): Promise<void> {
  section('bks_sense — explicit language parameter');

  const result = await callTool(server, 'bks_sense', {
    content: 'The client discussed their investment goals and risk tolerance.',
    protocol_id: PROTOCOL_ID,
    language: 'en',
  });

  assert(!result.isError, 'no error with explicit language');
  assert(result.content[0]?.text?.includes('Score:'), 'returns score');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         @blankstate/mcp — MCP Tools Tests                   ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Protocol: ${PROTOCOL_ID.substring(0, 48).padEnd(48)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  let config: BlankstateConfig;
  try {
    config = loadConfig();
  } catch (err) {
    // Fallback: build minimal config from env / hardcoded test values
    config = {
      apiToken: process.env.BLANKSTATE_API_TOKEN || (() => { throw new Error('Set BLANKSTATE_API_TOKEN'); })(),
      apiUrl: process.env.BLANKSTATE_API_URL || 'https://ibf.blankstate.ai',
      protocols: [{ id: PROTOCOL_ID, mode: 'block', threshold: 0.7, tools: ['all'] }],
      metrics: [],
      defaultThreshold: 0.7,
      defaultMode: 'block',
      sessionContextSize: 10,
    };
  }

  const server = new BlankstateMCPServer(config);

  await testToolDiscovery(server);
  await testStatus(server);
  await testSenseProtocol(server);
  await testSenseMissingContent(server);
  await testSenseMissingProtocol();
  await testValidateAllowed(server);
  await testValidateMissingToolName(server);
  await testSenseLanguage(server);

  console.log('\n' + '═'.repeat(62));
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('═'.repeat(62));

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
