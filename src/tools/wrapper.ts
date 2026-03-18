/**
 * @blankstate/mcp - Tool Wrapper
 * 
 * Core logic for wrapping tool calls with Protocol and Metric validation.
 * 
 * Supports:
 * - Protocols: Direct sensor calls via /api/v1/sense (pure measurement)
 * - Metrics: Aggregated protocol calls (combined with weights)
 * - Session context: Temporal analysis for Protocol 1.5+
 */

import { IBFClient, parseProtocolId } from '../api/ibfClient.js';
import { extractContent, shouldWrapTool } from './extractor.js';
import type {
  BlankstateConfig,
  ProtocolConfig,
  MetricConfig,
  ProtocolEvaluationResult,
  MetricEvaluationResult,
  BlockedResult,
  FeedbackAttachment,
  AuditEntry,
  ProtocolContribution,
  IBFSenseResponse,
} from '../types/index.js';

/**
 * Tool wrapper instance that handles Protocol and Metric validation
 */
export class ToolWrapper {
  private readonly config: BlankstateConfig;
  private readonly ibf: IBFClient;
  private readonly auditLog: AuditEntry[] = [];
  private readonly sessionContext: string[] = [];

  constructor(config: BlankstateConfig) {
    this.config = config;
    this.ibf = new IBFClient(config.apiToken, config.apiUrl);
  }

  /**
   * Wrap a tool call with Protocol and Metric validation
   * 
   * Returns either:
   * - { blocked: true, result: BlockedResult } if blocked
   * - { blocked: false, feedback?: FeedbackAttachment[], audit?: AuditEntry[] } if allowed
   */
  async wrapToolCall(
    toolName: string,
    args: unknown
  ): Promise<WrapResult> {
    // Find Protocols and Metrics that apply to this tool
    const applicableProtocols = this.config.protocols.filter(p =>
      shouldWrapTool(toolName, p.tools)
    );
    const applicableMetrics = this.config.metrics.filter(m =>
      shouldWrapTool(toolName, m.tools)
    );

    if (applicableProtocols.length === 0 && applicableMetrics.length === 0) {
      // No Protocols or Metrics apply to this tool, allow execution
      return { blocked: false };
    }

    // Extract content for analysis
    const extracted = extractContent(toolName, args);
    
    if (!extracted.content) {
      // No content to analyze, allow execution
      return { blocked: false };
    }

    // Add to session context for temporal analysis
    this.addToSessionContext(extracted.content);

    // Get session context for Protocol 1.5+ analysis
    const sessionContext = this.getSessionContext();

    // Evaluate against all applicable Protocols
    const protocolEvaluations = applicableProtocols.length > 0
      ? await this.evaluateProtocols(applicableProtocols, extracted.content, sessionContext)
      : [];

    // Evaluate against all applicable Metrics
    const metricEvaluations = applicableMetrics.length > 0
      ? await this.evaluateMetrics(applicableMetrics, extracted.content, sessionContext)
      : [];

    // Process results by mode - check Protocols first, then Metrics
    const blockedByProtocol = this.processProtocolBlockMode(protocolEvaluations);
    if (blockedByProtocol) {
      this.logAuditEntry(toolName, blockedByProtocol.source, 'protocol', blockedByProtocol.score, blockedByProtocol.nuances, 'blocked');
      return { blocked: true, result: blockedByProtocol };
    }

    const blockedByMetric = this.processMetricBlockMode(metricEvaluations);
    if (blockedByMetric) {
      this.logAuditEntry(toolName, blockedByMetric.source, 'metric', blockedByMetric.score, blockedByMetric.nuances, 'blocked', blockedByMetric.protocolContributions);
      return { blocked: true, result: blockedByMetric };
    }

    // Collect feedback from both Protocols and Metrics
    const feedback = [
      ...this.processProtocolFeedbackMode(protocolEvaluations),
      ...this.processMetricFeedbackMode(metricEvaluations),
    ];

    // Log audit entries for audit-mode evaluations
    for (const evaluation of protocolEvaluations) {
      if (evaluation.protocol.mode === 'audit') {
        this.logAuditEntry(toolName, evaluation.protocol.id, 'protocol', evaluation.score, evaluation.nuances, 'allowed');
      }
    }
    for (const evaluation of metricEvaluations) {
      if (evaluation.metric.mode === 'audit') {
        this.logAuditEntry(toolName, evaluation.metric.id, 'metric', evaluation.aggregatedScore, evaluation.nuances, 'allowed', evaluation.protocolContributions);
      }
    }

    return {
      blocked: false,
      feedback: feedback.length > 0 ? feedback : undefined,
      audit: this.auditLog.slice(-10), // Last 10 entries
    };
  }

  // ===========================================================================
  // Session Context Management (for Protocol 1.5+ temporal analysis)
  // ===========================================================================

  /**
   * Add content to session context buffer
   */
  private addToSessionContext(content: string): void {
    this.sessionContext.push(content);
    // Keep only the configured number of entries
    while (this.sessionContext.length > this.config.sessionContextSize) {
      this.sessionContext.shift();
    }
  }

  /**
   * Get current session context
   */
  private getSessionContext(): string[] {
    return [...this.sessionContext];
  }

  /**
   * Clear session context (e.g., on session reset)
   */
  clearSessionContext(): void {
    this.sessionContext.length = 0;
  }

  // ===========================================================================
  // Protocol Evaluation — via /api/v1/sense
  // ===========================================================================

  /**
   * Evaluate content against multiple Protocols using /api/v1/sense
   */
  private async evaluateProtocols(
    protocols: ProtocolConfig[],
    content: string,
    sessionContext: string[]
  ): Promise<ProtocolEvaluationResult[]> {
    const results = await Promise.allSettled(
      protocols.map(async (protocol): Promise<ProtocolEvaluationResult> => {
        const response = await this.ibf.senseSingle(
          protocol.id,
          content,
          'en',
          sessionContext.length > 0 ? sessionContext : undefined,
        );

        // Extract nuance labels from evidence items
        const nuanceLabels = response.evidence
          .filter(e => e.score > 0)
          .map(e => e.metamarker);
        const uniqueNuances = [...new Set(nuanceLabels)];

        // Extract evidence sources
        const evidenceSources = response.evidence
          .filter(e => e.score > 0)
          .map(e => e.source);

        return {
          protocol,
          score: response.score,
          nuances: uniqueNuances,
          evidence: evidenceSources,
          blocked: protocol.mode === 'block' && response.score >= protocol.threshold,
          senseResponse: response,
        };
      })
    );

    // Filter fulfilled results and extract values
    const fulfilled: ProtocolEvaluationResult[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        fulfilled.push(result.value);
      }
    }
    return fulfilled;
  }

  /**
   * Check if any Protocol in block mode should block execution
   */
  private processProtocolBlockMode(evaluations: ProtocolEvaluationResult[]): BlockedResult | null {
    for (const evaluation of evaluations) {
      if (evaluation.protocol.mode === 'block' && evaluation.blocked) {
        return {
          error: 'BLANKSTATE_BLOCKED',
          source: evaluation.protocol.id,
          sourceType: 'protocol',
          score: evaluation.score,
          nuances: evaluation.nuances,
          evidence: evaluation.evidence,
          message: `Action blocked by Protocol ${evaluation.protocol.id}. Score: ${evaluation.score.toFixed(3)}. Matched nuances: ${evaluation.nuances.join(', ')}`,
        };
      }
    }
    return null;
  }

  /**
   * Collect feedback from Protocols in feedback mode
   */
  private processProtocolFeedbackMode(evaluations: ProtocolEvaluationResult[]): FeedbackAttachment[] {
    const feedback: FeedbackAttachment[] = [];

    for (const evaluation of evaluations) {
      if (
        evaluation.protocol.mode === 'feedback' &&
        evaluation.score >= evaluation.protocol.threshold &&
        evaluation.nuances.length > 0
      ) {
        feedback.push({
          source: evaluation.protocol.id,
          sourceType: 'protocol',
          score: evaluation.score,
          suggestions: evaluation.nuances,
        });
      }
    }

    return feedback;
  }

  // ===========================================================================
  // Metric Evaluation (client-side aggregation using /api/v1/sense)
  // ===========================================================================

  /**
   * Evaluate content against multiple Metrics
   * 
   * For each Metric:
   * 1. Call /api/v1/sense for each protocol in the metric
   * 2. Aggregate the scores using the configured calculation method
   */
  private async evaluateMetrics(
    metrics: MetricConfig[],
    content: string,
    sessionContext: string[]
  ): Promise<MetricEvaluationResult[]> {
    const results = await Promise.allSettled(
      metrics.map(async (metric): Promise<MetricEvaluationResult> => {
        // If metric doesn't have protocols defined, skip it
        if (!metric.protocols || metric.protocols.length === 0) {
          console.warn(`[blankstate] Metric ${metric.id} has no protocols defined, skipping`);
          return {
            metric,
            aggregatedScore: 0,
            protocolContributions: [],
            nuances: [],
            evidence: [],
            flagTriggered: false,
            blocked: false,
          };
        }

        // Call each protocol in the metric via /api/v1/sense
        const protocolIds = metric.protocols.map(p => p.id);
        
        const protocolResponses = await this.ibf.senseMultiple(
          content,
          protocolIds,
          'en',
          sessionContext.length > 0 ? sessionContext : undefined
        );

        // Build protocol contributions from sense responses
        const contributions: ProtocolContribution[] = [];
        const allNuances: string[] = [];
        const allEvidence: string[] = [];

        for (const protocolRef of metric.protocols) {
          const response = protocolResponses.get(protocolRef.id);
          if (response) {
            const target = parseProtocolId(protocolRef.id);
            
            // Extract nuance labels from evidence
            const nuanceLabels = response.evidence
              .filter(e => e.score > 0)
              .map(e => e.metamarker);

            contributions.push({
              protocol_id: target.id,
              protocol_version: target.version || response.target?.version || '1.0',
              score: response.score || 0,
              weight: protocolRef.weight,
              nuances_matched: [...new Set(nuanceLabels)],
            });

            allNuances.push(...nuanceLabels);

            // Extract evidence sources
            for (const ev of response.evidence) {
              if (ev.source) {
                allEvidence.push(ev.source);
              }
            }
          }
        }

        // Calculate aggregated score
        const aggregatedScore = this.calculateMetricScore(metric, contributions);
        const flagTriggered = aggregatedScore >= metric.threshold;
        const isBlocked = metric.mode === 'block' && flagTriggered;

        return {
          metric,
          aggregatedScore,
          protocolContributions: contributions,
          nuances: [...new Set(allNuances)], // Deduplicate
          evidence: [...new Set(allEvidence)], // Deduplicate
          flagTriggered,
          blocked: isBlocked,
        };
      })
    );

    // Filter fulfilled results and extract values
    const fulfilled: MetricEvaluationResult[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result && result.status === 'fulfilled') {
        fulfilled.push(result.value);
      } else if (result && result.status === 'rejected') {
        console.error(`[blankstate] Metric ${metrics[i]?.id} evaluation failed:`, result.reason);
      }
    }
    return fulfilled;
  }

  /**
   * Calculate the aggregated metric score from protocol contributions
   */
  private calculateMetricScore(metric: MetricConfig, contributions: ProtocolContribution[]): number {
    if (contributions.length === 0) return 0;

    const method = metric.calculationMethod ?? 'weighted_average';

    switch (method) {
      case 'weighted_average': {
        // Weighted average: sum(score * weight) / sum(weight)
        let weightedSum = 0;
        let totalWeight = 0;
        for (const c of contributions) {
          weightedSum += c.score * c.weight;
          totalWeight += c.weight;
        }
        return totalWeight > 0 ? weightedSum / totalWeight : 0;
      }
      case 'max':
        return Math.max(...contributions.map(c => c.score));
      case 'min':
        return Math.min(...contributions.map(c => c.score));
      case 'sum':
        return contributions.reduce((sum, c) => sum + c.score * c.weight, 0);
      default:
        return contributions.reduce((sum, c) => sum + c.score * c.weight, 0) / contributions.length;
    }
  }

  /**
   * Check if any Metric in block mode should block execution
   */
  private processMetricBlockMode(evaluations: MetricEvaluationResult[]): BlockedResult | null {
    for (const evaluation of evaluations) {
      if (evaluation.metric.mode === 'block' && evaluation.blocked) {
        return {
          error: 'BLANKSTATE_BLOCKED',
          source: evaluation.metric.id,
          sourceType: 'metric',
          score: evaluation.aggregatedScore,
          nuances: evaluation.nuances,
          evidence: evaluation.evidence,
          protocolContributions: evaluation.protocolContributions,
          message: `Action blocked by Metric ${evaluation.metric.id}. Score: ${evaluation.aggregatedScore.toFixed(3)}. Matched nuances: ${evaluation.nuances.join(', ')}`,
        };
      }
    }
    return null;
  }

  /**
   * Collect feedback from Metrics in feedback mode
   */
  private processMetricFeedbackMode(evaluations: MetricEvaluationResult[]): FeedbackAttachment[] {
    const feedback: FeedbackAttachment[] = [];

    for (const evaluation of evaluations) {
      if (
        evaluation.metric.mode === 'feedback' &&
        evaluation.aggregatedScore >= evaluation.metric.threshold &&
        evaluation.nuances.length > 0
      ) {
        feedback.push({
          source: evaluation.metric.id,
          sourceType: 'metric',
          score: evaluation.aggregatedScore,
          suggestions: evaluation.nuances,
          protocolContributions: evaluation.protocolContributions,
        });
      }
    }

    return feedback;
  }

  // ===========================================================================
  // Audit Logging
  // ===========================================================================

  /**
   * Log an audit entry
   */
  private logAuditEntry(
    tool: string,
    source: string,
    sourceType: 'protocol' | 'metric',
    score: number,
    nuances: string[],
    action: 'allowed' | 'blocked' | 'feedback',
    protocolContributions?: ProtocolContribution[]
  ): void {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      tool,
      source,
      sourceType,
      score,
      nuances,
      action,
      protocolContributions,
    };
    this.auditLog.push(entry);

    // Keep only last 100 entries in memory
    if (this.auditLog.length > 100) {
      this.auditLog.shift();
    }
  }

  /**
   * Get audit log
   */
  getAuditLog(): AuditEntry[] {
    return [...this.auditLog];
  }

  /**
   * Clear audit log
   */
  clearAuditLog(): void {
    this.auditLog.length = 0;
  }
}

/**
 * Result of wrapping a tool call
 */
export interface WrapResult {
  blocked: boolean;
  result?: BlockedResult;
  feedback?: FeedbackAttachment[];
  audit?: AuditEntry[];
}

/**
 * Create a tool wrapper instance
 */
export function createToolWrapper(config: BlankstateConfig): ToolWrapper {
  return new ToolWrapper(config);
}
