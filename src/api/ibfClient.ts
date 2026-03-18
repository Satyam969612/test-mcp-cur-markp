/**
 * @blankstate/mcp - IBF API Client
 * 
 * Handles communication with the Blankstate IBF API.
 * 
 * Uses the unified /api/v1/sense endpoint.
 * Metrics are calculated client-side by aggregating protocol results.
 */

import type {
  IBFSenseRequest,
  IBFSenseResponse,
  IBFStatusResponse,
  SenseTarget,
} from '../types/index.js';

/**
 * Parse a protocol config ID (e.g. "proto-xxx:0.2") into SenseTarget
 */
export function parseProtocolId(protocolIdWithVersion: string): SenseTarget {
  // Find the last colon that separates the version
  const lastColon = protocolIdWithVersion.lastIndexOf(':');
  
  if (lastColon === -1) {
    // No version, use as-is
    return { type: 'protocol', id: protocolIdWithVersion };
  }

  const id = protocolIdWithVersion.substring(0, lastColon);
  const version = protocolIdWithVersion.substring(lastColon + 1);

  return { type: 'protocol', id, version };
}

/**
 * Client for the Blankstate IBF API v1
 */
export class IBFClient {
  private readonly apiToken: string;
  private readonly apiUrl: string;

  constructor(apiToken: string, apiUrl: string = 'https://ibf.blankstate.ai') {
    this.apiToken = apiToken;
    this.apiUrl = apiUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Sense an interaction against a single Protocol
   * 
   * POST /api/v1/sense
   */
  async sense(request: IBFSenseRequest): Promise<IBFSenseResponse> {
    const url = `${this.apiUrl}/api/v1/sense`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        'User-Agent': '@blankstate/mcp',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new IBFAPIError(
        `IBF API request failed: ${response.status} ${response.statusText}`,
        response.status,
        errorText
      );
    }

    const data = await response.json() as IBFSenseResponse;
    return data;
  }

  /**
   * Sense a single protocol by its config ID (e.g. "proto-xxx:0.2")
   * 
   * Convenience method that parses the protocol ID and calls /api/v1/sense
   */
  async senseSingle(
    protocolIdWithVersion: string,
    content: string,
    languageOrOpts?: string | { language?: string; profile?: string; sessionContext?: string[] },
    sessionContext?: string[],
  ): Promise<IBFSenseResponse> {
    let language = 'en';
    let profile: 'raw' | 'detailed' | 'discovery' = 'detailed';
    let ctx = sessionContext;

    if (typeof languageOrOpts === 'string') {
      language = languageOrOpts;
    } else if (languageOrOpts && typeof languageOrOpts === 'object') {
      language = languageOrOpts.language ?? 'en';
      profile = (languageOrOpts.profile as typeof profile) ?? 'detailed';
      ctx = languageOrOpts.sessionContext ?? sessionContext;
    }

    const target = parseProtocolId(protocolIdWithVersion);
    
    const request: IBFSenseRequest = {
      target,
      interaction: {
        content,
        language,
      },
      options: { profile },
    };

    if (ctx && ctx.length > 0) {
      request.interaction.segments = ctx.map((text, idx) => ({
        role: 'context',
        content: text,
        timestamp: new Date(Date.now() - (ctx!.length - idx) * 60000).toISOString(),
      }));
    }

    return this.sense(request);
  }

  /**
   * Sense content against multiple Protocols in parallel
   */
  async senseMultiple(
    content: string,
    protocolIds: string[],
    language: string = 'en',
    sessionContext?: string[]
  ): Promise<Map<string, IBFSenseResponse>> {
    const results = await Promise.allSettled(
      protocolIds.map(id =>
        this.senseSingle(id, content, language, sessionContext)
      )
    );

    const responseMap = new Map<string, IBFSenseResponse>();
    
    results.forEach((result, index) => {
      const protocolId = protocolIds[index];
      if (protocolId === undefined) return;
      
      if (result.status === 'fulfilled') {
        responseMap.set(protocolId, result.value);
      } else {
        console.error(`[blankstate] Protocol ${protocolId} sense failed:`, result.reason);
        // Store a minimal failed result
        const target = parseProtocolId(protocolId);
        responseMap.set(protocolId, {
          target,
          score: 0,
          resonance: {},
          evidence: [],
          fidelity: { index: 0, sufficient: false },
          ics: { consumed: 0, cost_usd: 0, sgm_version: '1.0' },
        });
      }
    });

    return responseMap;
  }

  /**
   * Get API status and capabilities
   * 
   * GET /api/v1/status
   */
  async status(): Promise<IBFStatusResponse> {
    const url = `${this.apiUrl}/api/v1/status`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'User-Agent': '@blankstate/mcp',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new IBFAPIError(
        `IBF status request failed: ${response.status} ${response.statusText}`,
        response.status,
        errorText
      );
    }

    return await response.json() as IBFStatusResponse;
  }

  /**
   * Health check for the API
   * 
   * GET /api/health
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/api/health`, {
        method: 'GET',
        headers: {
          'User-Agent': '@blankstate/mcp',
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Custom error class for IBF API errors
 */
export class IBFAPIError extends Error {
  public readonly statusCode: number;
  public readonly responseBody: string;

  constructor(message: string, statusCode: number, responseBody: string) {
    super(message);
    this.name = 'IBFAPIError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }

  /** Check if error is an authentication error */
  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  /** Check if error is an ICS quota exceeded error */
  isQuotaError(): boolean {
    return this.statusCode === 429;
  }

  /** Check if error is a rate limit error */
  isRateLimitError(): boolean {
    return this.statusCode === 429;
  }

  /** Check if error is a server error (retryable) */
  isServerError(): boolean {
    return this.statusCode >= 500;
  }
}
