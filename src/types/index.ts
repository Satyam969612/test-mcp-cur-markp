/**
 * @blankstate/mcp - Type Definitions
 * 
 * Core types for the Blankstate MCP server.
 * 
 * Architecture:
 * - Protocols: Pure sensors (interaction measurement, no business logic)
 * - Metrics: Aggregation layer (combines protocols with weights, optional thresholds)
 * - MCP: Transport layer (calls protocols or metrics, applies mode logic)
 * 
 * API: Uses unified /api/v1/sense endpoint
 */

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Protocol configuration for a single Protocol
 */
export interface ProtocolConfig {
  /** Protocol ID with version (e.g., "proto-6d28a7b8-...:0.2") */
  id: string;
  
  /** Execution mode */
  mode: 'block' | 'feedback' | 'audit';
  
  /** Score threshold (0.0 - 1.0) for triggering the mode action */
  threshold: number;
  
  /** Tool types this Protocol applies to */
  tools: ToolType[];
}

/**
 * Protocol reference within a Metric
 */
export interface MetricProtocolReference {
  /** Protocol ID with version */
  id: string;
  /** Weight for aggregation (0.0 - 1.0) */
  weight: number;
  /** Is this protocol required for the metric to be valid? */
  required?: boolean;
}

/**
 * Metric configuration
 * 
 * Metrics are defined in Atlas and referenced by ID.
 * The protocols array is optional: only needed for local/custom metrics
 * that aren't defined in Atlas.
 */
export interface MetricConfig {
  /** Metric ID from Atlas (e.g., "agent-safety-score") */
  id: string;
  
  /** Display name (optional) */
  name?: string;
  
  /** Execution mode */
  mode: 'block' | 'feedback' | 'audit';
  
  /** Score threshold for triggering the mode action (overrides Atlas default) */
  threshold: number;
  
  /** Tool types this Metric applies to */
  tools: ToolType[];
  
  /** 
   * Optional: Protocols that make up this metric with weights.
   * Only needed for local/custom metrics not defined in Atlas.
   * If omitted, MCP fetches the metric definition from Atlas.
   */
  protocols?: MetricProtocolReference[];
  
  /** Calculation method (only used with local protocols) */
  calculationMethod?: 'weighted_average' | 'max' | 'min' | 'sum';
}

/**
 * Full MCP configuration
 */
export interface BlankstateConfig {
  /** Bearer token from Atlas dashboard */
  apiToken: string;
  
  /** IBF API base URL */
  apiUrl: string;
  
  /** List of Protocols to evaluate (direct protocol calls) */
  protocols: ProtocolConfig[];
  
  /** List of Metrics to evaluate (aggregated protocol calls) */
  metrics: MetricConfig[];
  
  /** Default threshold if not specified per-protocol/metric */
  defaultThreshold: number;
  
  /** Default mode if not specified per-protocol/metric */
  defaultMode: 'block' | 'feedback' | 'audit';
  
  /** Session context buffer size for temporal analysis (Protocol 1.5+) */
  sessionContextSize: number;
}

/**
 * Tool types that can be wrapped
 */
export type ToolType = 
  | 'exec'      // execute_command, bash, shell
  | 'write'     // file_write, apply_patch
  | 'browser'   // browser actions, web navigation
  | 'messaging' // channel tools (slack, discord, email, etc.)
  | 'all';      // applies to all tools

// ============================================================================
// IBF API Types — /api/v1/sense
// ============================================================================

/**
 * Sense target — what to measure against
 */
export interface SenseTarget {
  type: 'protocol' | 'metric';
  id: string;
  version?: string;
}

/**
 * Interaction input — what to measure
 */
export interface InteractionInput {
  content?: string;
  segments?: Array<{ role: string; content: string; timestamp?: string }>;
  url?: string;
  language?: string;
}

/**
 * Sense output options
 */
export interface SenseOptions {
  profile?: 'raw' | 'detailed' | 'discovery';
}

/**
 * IBF Sense request — POST /api/v1/sense
 *
 * The SGM version is determined by the protocol definition.
 */
export interface IBFSenseRequest {
  target: SenseTarget;
  interaction: InteractionInput;
  options?: SenseOptions;
  depth?: 'measure' | 'full';
}

/**
 * Evidence item in sense response
 */
export interface EvidenceItem {
  metamarker: string;
  score: number;
  source: string;
  actant?: string | null;
  reconstruction?: Record<string, unknown> | null;
}

/**
 * Weak signal in discovery profile
 */
export interface WeakSignal {
  metamarker: string;
  proximity: number;
  hint: string;
}

/**
 * Signal analysis (v1.5)
 */
export interface SignalAnalysis {
  spread: number;
  coherence: number;
  dominant_mode: string;
}

/**
 * Fidelity information
 */
export interface FidelityInfo {
  index: number;
  sufficient: boolean;
  density?: number;
  clarity?: number;
}

/**
 * ICS pool status
 */
export interface ICSPoolInfo {
  used?: number;
  quota?: number;
  remaining?: number;
}

/**
 * ICS consumption info
 */
export interface ICSInfo {
  consumed: number;
  cost_usd: number;
  sgm_version: string;
  pool?: ICSPoolInfo;
}

/**
 * V1.5 resolved entity detail
 */
export interface V15ResolvedEntity {
  canonicalName: string;
  entityType: string;
  isActant: boolean;
  totalMentions: number;
  segmentIndices: number[];
  spectralProfile?: Record<string, number>;
}

/**
 * V1.5 entity extraction result
 */
export interface V15Entities {
  totalResolved: number;
  actantCount: number;
  nonActantCount: number;
  resolved: V15ResolvedEntity[];
}

/**
 * V1.5 segmentation result
 */
export interface V15Segmentation {
  detectedMode: string;
  totalChars: number;
  numSegments: number;
  speakersFound: string[];
}

/**
 * V1.5 detail block — additional spectral data from SGM 1.5 pipeline
 */
export interface V15Detail {
  segmentation?: V15Segmentation;
  entities?: V15Entities;
  cxbi_aggregate?: Record<string, number>;
  clusters?: Record<string, unknown>;
  timeline?: Array<Record<string, unknown>>;
}

/**
 * IBF Sense response — returned by POST /api/v1/sense
 */
export interface IBFSenseResponse {
  target: SenseTarget;
  profile?: string;
  score: number;
  resonance: Record<string, number>;
  evidence: EvidenceItem[];
  weak_signals?: WeakSignal[];
  signal?: SignalAnalysis;
  fidelity: FidelityInfo;
  actant_flow?: {
    primary_driven: string[];
    secondary_driven: string[];
    direction: string;
    balance: number;
  };
  temporal?: {
    trend: string;
    phase_shifts: number;
  };
  ics: ICSInfo;
  v15?: V15Detail;
}

/**
 * IBF Status response — GET /api/v1/status
 */
export interface IBFStatusResponse {
  status: string;
  version: string;
  authenticated: boolean;
  sgm_versions: Record<string, string>;
  profiles: string[];
  supported_modalities: string[];
  ics?: {
    remaining: number;
    period: string;
  };
}

// ============================================================================
// Legacy types — kept for backward compatibility
// ============================================================================

/** @deprecated Use IBFSenseRequest instead */
export interface IBFAnalysisRequest {
  protocol_id_with_version: string;
  content: string;
  concept_hit_threshold?: number;
  nuance_activation_threshold?: number;
  session_context?: string[];
}

/** @deprecated Use IBFSenseResponse instead */
export interface IBFAnalysisResponse {
  protocol_id: string;
  protocol_version: string;
  page_score: number;
  key_nuances_matched: string[];
  sentences_evaluations?: SentenceEvaluation[];
  nuance_activation_details?: NuanceDetail[];
}

// ============================================================================
// Evaluation Result Types
// ============================================================================

/**
 * Protocol contribution within a Metric result (calculated client-side)
 */
export interface ProtocolContribution {
  protocol_id: string;
  protocol_version: string;
  score: number;
  weight: number;
  nuances_matched: string[];
}

/**
 * Metric analysis result (calculated client-side from protocol results)
 */
export interface MetricAnalysisResult {
  metric_id: string;
  aggregated_score: number;
  protocol_contributions: ProtocolContribution[];
  flag_triggered: boolean;
  key_nuances_matched: string[];
  evidence?: string[];
}

/**
 * Sentence-level evaluation from IBF (legacy)
 */
export interface SentenceEvaluation {
  sentence: string;
  score: number;
  markers?: string[];
  nuances_matched?: string[];
}

/**
 * Nuance activation detail (legacy)
 */
export interface NuanceDetail {
  nuance_id: string;
  nuance_name: string;
  activation_score: number;
  evidence?: string;
}

/**
 * Result of Protocol evaluation
 */
export interface ProtocolEvaluationResult {
  protocol: ProtocolConfig;
  score: number;
  nuances: string[];
  evidence?: string[];
  blocked: boolean;
  feedback?: string;
  /** Full sense response for rich data access */
  senseResponse?: IBFSenseResponse;
}

/**
 * Result of Metric evaluation
 */
export interface MetricEvaluationResult {
  metric: MetricConfig;
  aggregatedScore: number;
  protocolContributions: ProtocolContribution[];
  nuances: string[];
  evidence?: string[];
  flagTriggered: boolean;
  checkpointStatus?: 'passed' | 'failed' | 'incomplete' | 'not_configured';
  blocked: boolean;
  feedback?: string;
}

/**
 * MCP tool wrapper result - returned when action is blocked
 */
export interface BlockedResult {
  error: 'BLANKSTATE_BLOCKED';
  /** Protocol ID or Metric ID that caused the block */
  source: string;
  /** Type of source */
  sourceType: 'protocol' | 'metric';
  /** Score that triggered the block */
  score: number;
  nuances: string[];
  evidence?: string[];
  message: string;
  /** For metrics: which protocols contributed to the block */
  protocolContributions?: ProtocolContribution[];
}

/**
 * MCP tool wrapper result - feedback attached to allowed execution
 */
export interface FeedbackAttachment {
  /** Protocol ID or Metric ID */
  source: string;
  sourceType: 'protocol' | 'metric';
  score: number;
  suggestions: string[];
  /** For metrics: breakdown by protocol */
  protocolContributions?: ProtocolContribution[];
}

/**
 * Extended tool result with Blankstate feedback
 */
export interface ToolResultWithFeedback<T = unknown> {
  result: T;
  blankstate_feedback?: FeedbackAttachment[];
  blankstate_audit?: AuditEntry[];
}

/**
 * Audit log entry
 */
export interface AuditEntry {
  timestamp: string;
  tool: string;
  /** Protocol ID or Metric ID */
  source: string;
  sourceType: 'protocol' | 'metric';
  score: number;
  nuances: string[];
  action: 'allowed' | 'blocked' | 'feedback';
  /** For metrics: breakdown by protocol */
  protocolContributions?: ProtocolContribution[];
}

/**
 * Content extraction result from tool arguments
 */
export interface ExtractedContent {
  /** Combined content string for Protocol analysis */
  content: string;
  
  /** Metadata about the extraction */
  metadata: {
    tool: string;
    extractedFields: string[];
  };
}
