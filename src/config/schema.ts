/**
 * @blankstate/mcp - Configuration Schema & Loader
 * 
 * Handles loading configuration from:
 * 1. Environment variables (BLANKSTATE_*)
 * 2. Config file (~/.blankstate/config.json)
 * 3. Defaults
 * 
 * Supports both:
 * - Protocols: Direct sensor calls (pure measurement)
 * - Metrics: Aggregated protocol calls (combined with weights)
 */

import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { BlankstateConfig, ProtocolConfig, MetricConfig, ToolType } from '../types/index.js';

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

const ToolTypeSchema = z.enum(['exec', 'write', 'browser', 'messaging', 'all']);

const ModeSchema = z.enum(['block', 'feedback', 'audit']);

const ProtocolConfigSchema = z.object({
  id: z.string().regex(/^[\w.\-]+:(\d+[\.\d]*|latest)$/, 'Protocol ID must be in format "name:version" (e.g., proto-6d28a7b8-...:0.2 or proto-...:latest)'),
  mode: ModeSchema.optional(),
  threshold: z.number().min(0).max(1).optional(),
  tools: z.array(ToolTypeSchema).optional(),
});

const MetricProtocolRefSchema = z.object({
  id: z.string().regex(/^[\w.\-]+:(\d+[\.\d]*|latest)$/, 'Protocol ID must be in format "name:version"'),
  weight: z.number().min(0).max(1).default(1.0),
  required: z.boolean().optional(),
});

const MetricConfigSchema = z.object({
  id: z.string().min(1, 'Metric ID is required'),
  name: z.string().optional(),
  mode: ModeSchema.optional(),
  threshold: z.number().min(0).max(1).optional(),
  tools: z.array(ToolTypeSchema).optional(),
  protocols: z.array(MetricProtocolRefSchema).optional(),
  calculationMethod: z.enum(['weighted_average', 'max', 'min', 'sum']).optional(),
});

const ConfigFileSchema = z.object({
  apiToken: z.string().optional(),
  apiUrl: z.string().url().optional(),
  defaultThreshold: z.number().min(0).max(1).optional(),
  defaultMode: ModeSchema.optional(),
  protocols: z.array(ProtocolConfigSchema).optional(),
  metrics: z.array(MetricConfigSchema).optional(),
  sessionContextSize: z.number().min(0).max(100).optional(),
});

// ============================================================================
// Default Values
// ============================================================================

const DEFAULTS = {
  apiUrl: 'https://ibf.blankstate.ai',
  defaultThreshold: 0.7,
  defaultMode: 'block' as const,
  defaultTools: ['all'] as ToolType[],
  sessionContextSize: 10, // Keep last 10 commands for temporal analysis
};

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Load configuration from all sources and merge
 */
export function loadConfig(): BlankstateConfig {
  // 1. Start with defaults
  let config: Partial<BlankstateConfig> = {
    apiUrl: DEFAULTS.apiUrl,
    defaultThreshold: DEFAULTS.defaultThreshold,
    defaultMode: DEFAULTS.defaultMode,
    protocols: [],
    metrics: [],
    sessionContextSize: DEFAULTS.sessionContextSize,
  };

  // 2. Load from config file if exists
  const configFilePath = join(homedir(), '.blankstate', 'config.json');
  if (existsSync(configFilePath)) {
    try {
      const fileContent = readFileSync(configFilePath, 'utf-8');
      const parsed = JSON.parse(fileContent);
      const validated = ConfigFileSchema.parse(parsed);
      
      // Map file protocols to ensure required fields have defaults
      const fileProtocols: ProtocolConfig[] = (validated.protocols ?? []).map(p => ({
        id: p.id,
        mode: p.mode ?? validated.defaultMode ?? DEFAULTS.defaultMode,
        threshold: p.threshold ?? validated.defaultThreshold ?? DEFAULTS.defaultThreshold,
        tools: p.tools ?? DEFAULTS.defaultTools,
      }));
      
      // Map file metrics to ensure required fields have defaults
      const fileMetrics: MetricConfig[] = (validated.metrics ?? []).map(m => ({
        id: m.id,
        name: m.name,
        mode: m.mode ?? validated.defaultMode ?? DEFAULTS.defaultMode,
        threshold: m.threshold ?? validated.defaultThreshold ?? DEFAULTS.defaultThreshold,
        tools: m.tools ?? DEFAULTS.defaultTools,
        protocols: m.protocols?.map(p => ({
          id: p.id,
          weight: p.weight ?? 1.0,
          required: p.required,
        })),
        calculationMethod: m.calculationMethod,
      }));
      
      config = {
        ...config,
        apiToken: validated.apiToken ?? config.apiToken,
        apiUrl: validated.apiUrl ?? config.apiUrl,
        defaultThreshold: validated.defaultThreshold ?? config.defaultThreshold,
        defaultMode: validated.defaultMode ?? config.defaultMode,
        protocols: fileProtocols,
        metrics: fileMetrics,
        sessionContextSize: validated.sessionContextSize ?? config.sessionContextSize,
      };
    } catch (error) {
      console.error(`[blankstate] Warning: Could not parse config file at ${configFilePath}:`, error);
    }
  }

  // 3. Override with environment variables (highest priority)
  const envToken = process.env.BLANKSTATE_API_TOKEN;
  const envApiUrl = process.env.BLANKSTATE_API_URL;
  const envProtocols = process.env.BLANKSTATE_PROTOCOLS;
  const envMetrics = process.env.BLANKSTATE_METRICS;
  const envThreshold = process.env.BLANKSTATE_THRESHOLD;
  const envMode = process.env.BLANKSTATE_MODE;
  const envSessionContextSize = process.env.BLANKSTATE_SESSION_CONTEXT_SIZE;

  if (envToken) {
    config.apiToken = envToken;
  }

  if (envApiUrl) {
    config.apiUrl = envApiUrl;
  }

  if (envThreshold) {
    const parsed = parseFloat(envThreshold);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      config.defaultThreshold = parsed;
    }
  }

  if (envMode && ['block', 'feedback', 'audit'].includes(envMode)) {
    config.defaultMode = envMode as 'block' | 'feedback' | 'audit';
  }

  if (envSessionContextSize) {
    const parsed = parseInt(envSessionContextSize);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
      config.sessionContextSize = parsed;
    }
  }

  // Parse BLANKSTATE_PROTOCOLS (comma-separated list)
  if (envProtocols) {
    const protocolIds = envProtocols.split(',').map(p => p.trim()).filter(Boolean);
    const envProtocolConfigs: ProtocolConfig[] = protocolIds.map(id => ({
      id,
      mode: config.defaultMode!,
      threshold: config.defaultThreshold!,
      tools: DEFAULTS.defaultTools,
    }));
    
    // Merge with file-based protocols (env overrides)
    config.protocols = mergeProtocols(config.protocols ?? [], envProtocolConfigs);
  }

  // Parse BLANKSTATE_METRICS (comma-separated list)
  if (envMetrics) {
    const metricIds = envMetrics.split(',').map(m => m.trim()).filter(Boolean);
    const envMetricConfigs: MetricConfig[] = metricIds.map(id => ({
      id,
      mode: config.defaultMode!,
      threshold: config.defaultThreshold!,
      tools: DEFAULTS.defaultTools,
    }));
    
    // Merge with file-based metrics (env overrides)
    config.metrics = mergeMetrics(config.metrics ?? [], envMetricConfigs);
  }

  // 4. Apply defaults to each protocol
  config.protocols = (config.protocols ?? []).map(p => ({
    id: p.id,
    mode: p.mode ?? config.defaultMode!,
    threshold: p.threshold ?? config.defaultThreshold!,
    tools: p.tools ?? DEFAULTS.defaultTools,
  }));

  // 5. Apply defaults to each metric
  config.metrics = (config.metrics ?? []).map(m => ({
    id: m.id,
    name: m.name,
    mode: m.mode ?? config.defaultMode!,
    threshold: m.threshold ?? config.defaultThreshold!,
    tools: m.tools ?? DEFAULTS.defaultTools,
    protocols: m.protocols,
    calculationMethod: m.calculationMethod,
  }));

  // 6. Validate required fields
  if (!config.apiToken) {
    throw new Error(
      '[blankstate] Missing API token. Set BLANKSTATE_API_TOKEN environment variable or add apiToken to ~/.blankstate/config.json'
    );
  }

  // At least one protocol OR one metric must be configured
  if (config.protocols.length === 0 && config.metrics.length === 0) {
    throw new Error(
      '[blankstate] No Protocols or Metrics configured. Set BLANKSTATE_PROTOCOLS or BLANKSTATE_METRICS environment variable, or add to ~/.blankstate/config.json'
    );
  }

  return config as BlankstateConfig;
}

/**
 * Merge protocol configurations, with second array taking precedence for matching IDs
 */
function mergeProtocols(base: ProtocolConfig[], override: ProtocolConfig[]): ProtocolConfig[] {
  const merged = new Map<string, ProtocolConfig>();
  
  for (const p of base) {
    merged.set(p.id, p);
  }
  
  for (const p of override) {
    merged.set(p.id, { ...merged.get(p.id), ...p });
  }
  
  return Array.from(merged.values());
}

/**
 * Merge metric configurations, with second array taking precedence for matching IDs
 */
function mergeMetrics(base: MetricConfig[], override: MetricConfig[]): MetricConfig[] {
  const merged = new Map<string, MetricConfig>();
  
  for (const m of base) {
    merged.set(m.id, m);
  }
  
  for (const m of override) {
    merged.set(m.id, { ...merged.get(m.id), ...m });
  }
  
  return Array.from(merged.values());
}

/**
 * Parse a single protocol string (for CLI usage)
 * Format: "protocol-id:version" or "protocol-id:version:mode:threshold"
 */
export function parseProtocolString(str: string): ProtocolConfig {
  const parts = str.split(':');
  
  if (parts.length < 2) {
    throw new Error(`Invalid protocol format: "${str}". Expected "name:version" (e.g., circuit-breaker:1.0)`);
  }

  const id = `${parts[0]}:${parts[1]}`;
  const mode = (parts[2] as 'block' | 'feedback' | 'audit') ?? DEFAULTS.defaultMode;
  const threshold = parts[3] ? parseFloat(parts[3]) : DEFAULTS.defaultThreshold;

  return {
    id,
    mode,
    threshold,
    tools: DEFAULTS.defaultTools,
  };
}

/**
 * Validate that a config is complete and valid
 */
export function validateConfig(config: BlankstateConfig): void {
  if (!config.apiToken) {
    throw new Error('API token is required');
  }

  if (!config.apiUrl) {
    throw new Error('API URL is required');
  }

  if (config.protocols.length === 0 && config.metrics.length === 0) {
    throw new Error('At least one Protocol or Metric must be configured');
  }

  for (const protocol of config.protocols) {
    if (!protocol.id.match(/^[\w.\-]+:(\d+[\.\d]*|latest)$/)) {
      throw new Error(`Invalid protocol ID format: ${protocol.id}`);
    }
  }

  for (const metric of config.metrics) {
    if (!metric.id || metric.id.trim() === '') {
      throw new Error('Metric ID cannot be empty');
    }
  }
}
