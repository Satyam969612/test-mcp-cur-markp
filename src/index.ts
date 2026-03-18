#!/usr/bin/env node
/**
 * @blankstate/mcp
 * 
 * Blankstate MCP Server - Protocol-based validation for autonomous AI agents.
 * 
 * This package provides an MCP (Model Context Protocol) server that intercepts
 * tool calls from AI agents and validates them against Blankstate Protocols
 * before allowing execution.
 * 
 * Usage:
 *   npx @blankstate/mcp
 * 
 * Configuration:
 *   Set environment variables:
 *   - BLANKSTATE_API_TOKEN: Your API token from Atlas
 *   - BLANKSTATE_PROTOCOLS: Comma-separated Protocol IDs (e.g., "circuit-breaker:1.0")
 *   - BLANKSTATE_THRESHOLD: Score threshold for blocking (0.0-1.0, default: 0.7)
 *   - BLANKSTATE_MODE: "block" | "feedback" | "audit" (default: "block")
 * 
 *   Or create ~/.blankstate/config.json with full configuration.
 * 
 * @module @blankstate/mcp
 */

import { startServer, BlankstateMCPServer } from './server.js';
import { loadConfig, validateConfig } from './config/schema.js';
import { IBFClient, parseProtocolId } from './api/ibfClient.js';
import { ToolWrapper, createToolWrapper } from './tools/wrapper.js';
import { extractContent, getToolType, shouldWrapTool } from './tools/extractor.js';

// Export public API
export {
  // Server
  BlankstateMCPServer,
  startServer,
  
  // Configuration
  loadConfig,
  validateConfig,
  
  // API Client
  IBFClient,
  parseProtocolId,
  
  // Tool Wrapper
  ToolWrapper,
  createToolWrapper,
  
  // Utilities
  extractContent,
  getToolType,
  shouldWrapTool,
};

// Export types
export type {
  BlankstateConfig,
  ProtocolConfig,
  ToolType,
  IBFSenseRequest,
  IBFSenseResponse,
  SenseTarget,
  InteractionInput,
  SenseOptions,
  EvidenceItem,
  FidelityInfo,
  ICSInfo,
  ProtocolEvaluationResult,
  BlockedResult,
  FeedbackAttachment,
  AuditEntry,
  // Legacy (deprecated)
  IBFAnalysisRequest,
  IBFAnalysisResponse,
} from './types/index.js';

// CLI entry point
export async function main(): Promise<void> {
  console.error('╔══════════════════════════════════════════════════════════════╗');
  console.error('║                    @blankstate/mcp                           ║');
  console.error('║         Protocol-based validation for AI agents              ║');
  console.error('╚══════════════════════════════════════════════════════════════╝');
  console.error('');

  try {
    // Load and validate configuration
    const config = loadConfig();
    validateConfig(config);

    console.error(`[blankstate] Configuration loaded successfully`);
    console.error(`[blankstate] Protocols: ${config.protocols.map(p => `${p.id} (${p.mode})`).join(', ')}`);
    console.error('');

    // Start the server
    const server = await startServer(config);

    // Handle shutdown
    process.on('SIGINT', async () => {
      console.error('\n[blankstate] Received SIGINT, shutting down...');
      await server.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.error('\n[blankstate] Received SIGTERM, shutting down...');
      await server.stop();
      process.exit(0);
    });

  } catch (error) {
    console.error('[blankstate] Failed to start server:');
    console.error(error instanceof Error ? error.message : error);
    console.error('');
    console.error('Usage:');
    console.error('  Set BLANKSTATE_API_TOKEN and BLANKSTATE_PROTOCOLS environment variables');
    console.error('  Or create ~/.blankstate/config.json');
    console.error('');
    console.error('Example:');
    console.error('  BLANKSTATE_API_TOKEN=your-token BLANKSTATE_PROTOCOLS=circuit-breaker:1.0 npx @blankstate/mcp');
    process.exit(1);
  }
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`;
if (isMainModule) {
  main().catch((error) => {
    console.error('[blankstate] Unhandled error:', error);
    process.exit(1);
  });
}
