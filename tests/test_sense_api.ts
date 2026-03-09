#!/usr/bin/env npx tsx
/**
 * @blankstate/mcp - API Integration Tests
 * 
 * Tests the IBF client against the live /api/v1/sense endpoint.
 * 
 * Usage:
 *   npx tsx tests/test_sense_api.ts
 * 
 * Environment:
 *   BLANKSTATE_API_TOKEN - API token (defaults to test token below)
 *   BLANKSTATE_API_URL   - IBF URL (defaults to https://ibf.blankstate.ai)
 */

import { IBFClient, parseProtocolId } from '../src/api/ibfClient.js';
import type { IBFSenseResponse, SenseTarget } from '../src/types/index.js';

// ── Configuration ──────────────────────────────────────────────────────────
const API_TOKEN = process.env.BLANKSTATE_API_TOKEN || (() => { console.error('Set BLANKSTATE_API_TOKEN'); process.exit(1); return ''; })();
const API_URL = process.env.BLANKSTATE_API_URL || 'https://ibf.blankstate.ai';
const PROTOCOL_ID = process.env.BLANKSTATE_TEST_PROTOCOL || (() => { console.error('Set BLANKSTATE_TEST_PROTOCOL'); process.exit(1); return ''; })();
const PROTOCOL_ID_15 = process.env.BLANKSTATE_TEST_PROTOCOL_15 || 'proto-8f2e4889-918c-4cf1-a0c1-7bae1c3b2a39:0.5';

// ── Test Helpers ───────────────────────────────────────────────────────────
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

// ── Tests ──────────────────────────────────────────────────────────────────

async function testParseProtocolId(): Promise<void> {
  section('parseProtocolId');

  // Standard format
  const t1 = parseProtocolId('proto-6d28a7b8-a905-45f3-81f5-2cd574813450:0.2');
  assert(t1.type === 'protocol', 'type is "protocol"');
  assert(t1.id === 'proto-6d28a7b8-a905-45f3-81f5-2cd574813450', 'id parsed correctly');
  assert(t1.version === '0.2', 'version parsed correctly');

  // Simple format
  const t2 = parseProtocolId('circuit-breaker:1.0');
  assert(t2.type === 'protocol', 'simple: type is "protocol"');
  assert(t2.id === 'circuit-breaker', 'simple: id parsed correctly');
  assert(t2.version === '1.0', 'simple: version parsed correctly');

  // No version
  const t3 = parseProtocolId('my-protocol');
  assert(t3.type === 'protocol', 'no-version: type is "protocol"');
  assert(t3.id === 'my-protocol', 'no-version: id parsed correctly');
  assert(t3.version === undefined, 'no-version: version is undefined');
}

async function testHealthCheck(): Promise<void> {
  section('Health Check — GET /api/health');

  const client = new IBFClient(API_TOKEN, API_URL);
  const healthy = await client.healthCheck();
  assert(healthy === true, `API is healthy (${API_URL})`);
}

async function testStatus(): Promise<void> {
  section('Status — GET /api/v1/status');

  const client = new IBFClient(API_TOKEN, API_URL);
  
  try {
    const status = await client.status();
    assert(status.status === 'healthy', `status is "healthy"`);
    assertType(status.version, 'string', 'version is a string');
    assert(status.authenticated === true, 'token is authenticated');
    assert(typeof status.sgm_versions === 'object', 'sgm_versions is present');
    console.log(`    SGM versions: ${JSON.stringify(status.sgm_versions)}`);
    console.log(`    Profiles: ${JSON.stringify(status.profiles)}`);
    if (status.ics) {
      console.log(`    ICS remaining: ${status.ics.remaining}`);
    }
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`  ✗ Status check failed: ${err.message}`);
    failed++;
  }
}

async function testSenseSingle(): Promise<void> {
  section('Sense Single — POST /api/v1/sense');

  const client = new IBFClient(API_TOKEN, API_URL);
  
  const testContent = 
    'The Federal Reserve raised interest rates today by 25 basis points, ' +
    'citing persistent inflation concerns. Markets responded with cautious ' +
    'optimism, with the S&P 500 gaining 0.3%. Analysts predict economic ' +
    'growth will slow to 2.1% in the next quarter, down from the current ' +
    '2.8% rate. Consumer confidence remains stable despite rising costs.';

  try {
    const response = await client.senseSingle(PROTOCOL_ID, testContent);

    // Validate response structure
    assert(response.target !== undefined, 'response has target');
    assert(response.target.type === 'protocol', 'target type is "protocol"');
    assertType(response.score, 'number', 'score is a number');
    assert(response.score >= 0 && response.score <= 1, `score in range [0,1]: ${response.score.toFixed(4)}`);
    assert(typeof response.resonance === 'object', 'resonance is present');
    assert(Array.isArray(response.evidence), 'evidence is an array');
    assert(response.fidelity !== undefined, 'fidelity is present');
    assertType(response.fidelity.index, 'number', 'fidelity.index is a number');
    assertType(response.fidelity.sufficient, 'boolean', 'fidelity.sufficient is a boolean');
    assert(response.ics !== undefined, 'ics info is present');
    assertType(response.ics.consumed, 'number', 'ics.consumed is a number');

    // Log details
    console.log(`\n  Details:`);
    console.log(`    Score: ${response.score.toFixed(4)}`);
    console.log(`    Fidelity: ${response.fidelity.index.toFixed(4)} (sufficient: ${response.fidelity.sufficient})`);
    console.log(`    Evidence items: ${response.evidence.length}`);
    console.log(`    ICS consumed: ${response.ics.consumed}`);
    console.log(`    SGM version: ${response.ics.sgm_version}`);
    
    if (response.evidence.length > 0) {
      console.log(`    Top evidence:`);
      for (const ev of response.evidence.slice(0, 3)) {
        console.log(`      - [${ev.score.toFixed(3)}] ${ev.metamarker}: "${ev.source.substring(0, 80)}..."`);
      }
    }
    
    const resonanceKeys = Object.keys(response.resonance);
    if (resonanceKeys.length > 0) {
      console.log(`    Resonance (${resonanceKeys.length} metamarkers):`);
      for (const [key, val] of Object.entries(response.resonance)) {
        console.log(`      - ${key}: ${(val as number).toFixed(4)}`);
      }
    }

    if (response.ics.pool) {
      console.log(`    ICS pool: ${response.ics.pool.used}/${response.ics.pool.quota} used, ${response.ics.pool.remaining} remaining`);
    }
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`  ✗ Sense single failed: ${err.message}`);
    failed++;
  }
}

async function testSenseSGM15(): Promise<void> {
  section('Sense SGM 1.5 — POST /api/v1/sense');

  const client = new IBFClient(API_TOKEN, API_URL);

  const testContent =
    'Dr. Patel from Apex Solutions offered Mr. Chen at Vertex Capital a 15 percent discount on the annual contract. ' +
    'Sarah from procurement flagged the implementation timeline as a concern, but both sides agreed that accelerating ' +
    'deployment to six weeks would create mutual value and secure a long-term partnership.';

  try {
    const response = await client.senseSingle(PROTOCOL_ID_15, testContent, {
      profile: 'detailed',
    });

    assert(response.target !== undefined, 'response has target');
    assertType(response.score, 'number', 'score is a number');
    assert(response.score >= 0 && response.score <= 1, `score in range [0,1]: ${response.score.toFixed(4)}`);
    assert(typeof response.resonance === 'object', 'resonance is present');
    assert(Array.isArray(response.evidence), 'evidence is an array');
    assertType(response.ics.consumed, 'number', 'ics.consumed is a number');
    console.log(`    SGM version: ${response.ics.sgm_version}`);
    console.log(`    Score: ${response.score.toFixed(4)}`);
    console.log(`    Evidence items: ${response.evidence.length}`);

    if ((response as any).signal) {
      const sig = (response as any).signal;
      assert(typeof sig.spread === 'number', `signal.spread: ${sig.spread}`);
      assert(typeof sig.coherence === 'number', `signal.coherence: ${sig.coherence}`);
      console.log(`    Signal — spread: ${sig.spread.toFixed(4)}, coherence: ${sig.coherence.toFixed(4)}, dominant: ${sig.dominant_mode}`);
    } else {
      console.log('    (signal analysis not returned)');
    }

    if ((response as any).actant_flow) {
      const af = (response as any).actant_flow;
      assert(typeof af.direction === 'string', `actant direction: ${af.direction}`);
      console.log(`    Actant — direction: ${af.direction}, balance: ${af.balance}`);
    } else {
      console.log('    (actant flow not returned)');
    }

    if ((response as any).temporal) {
      const t = (response as any).temporal;
      assert(typeof t.trend === 'string', `temporal trend: ${t.trend}`);
      console.log(`    Temporal — trend: ${t.trend}, phase_shifts: ${t.phase_shifts}`);
    } else {
      console.log('    (temporal analysis not returned)');
    }

    assert((response as any).v15 != null, 'v15 detail block present');
    if ((response as any).v15) {
      const v15 = (response as any).v15;
      if (v15.segmentation) {
        assert(typeof v15.segmentation.numSegments === 'number', `v15 segments: ${v15.segmentation.numSegments}`);
        console.log(`    Segmentation — mode: ${v15.segmentation.detectedMode}, segments: ${v15.segmentation.numSegments}`);
      }
      if (v15.entities) {
        assert(typeof v15.entities.totalResolved === 'number', `v15 entities: ${v15.entities.totalResolved}`);
        assert(typeof v15.entities.actantCount === 'number', `v15 actants: ${v15.entities.actantCount}`);
        console.log(`    Entities — total: ${v15.entities.totalResolved}, actants: ${v15.entities.actantCount}`);
        if (v15.entities.resolved?.length > 0) {
          for (const ent of v15.entities.resolved.slice(0, 5)) {
            const role = ent.isActant ? 'actant' : 'non-actant';
            console.log(`      ${ent.canonicalName} [${ent.entityType}/${role}] — ${ent.totalMentions} mentions`);
          }
        }
      }
      if (v15.cxbi_aggregate) {
        assert(typeof v15.cxbi_aggregate === 'object', 'v15 cxbi_aggregate is object');
        const cx = v15.cxbi_aggregate;
        console.log(`    C×B×I: C=${(cx.cognitive ?? 0).toFixed(2)} B=${(cx.behavioral ?? 0).toFixed(2)} I=${(cx.intentional ?? 0).toFixed(2)}`);
      }
    }
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`  ✗ Sense SGM 1.5 failed: ${err.message}`);
    failed++;
  }
}

async function testSenseMultiple(): Promise<void> {
  section('Sense Multiple — parallel /api/v1/sense');

  const client = new IBFClient(API_TOKEN, API_URL);
  
  const testContent = 
    'GDP growth exceeded expectations at 3.2%, driven by strong consumer spending. ' +
    'However, the unemployment rate ticked up to 4.1%, raising concerns about a ' +
    'potential slowdown. The Fed is expected to hold rates steady at the next meeting.';

  // Test with the same protocol called multiple times (simulating metric with multiple protocols)
  try {
    const responses = await client.senseMultiple(
      testContent,
      [PROTOCOL_ID],
    );

    assert(responses.size === 1, `got ${responses.size} response(s)`);

    const resp = responses.get(PROTOCOL_ID);
    if (resp) {
      assert(resp.score >= 0, `score >= 0: ${resp.score.toFixed(4)}`);
      assert(Array.isArray(resp.evidence), 'evidence is an array');
      console.log(`    Score: ${resp.score.toFixed(4)}, Evidence: ${resp.evidence.length} items`);
    } else {
      console.error(`  ✗ No response for protocol ${PROTOCOL_ID}`);
      failed++;
    }
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`  ✗ Sense multiple failed: ${err.message}`);
    failed++;
  }
}

async function testSenseWithShortContent(): Promise<void> {
  section('Sense with short content (fidelity check)');

  const client = new IBFClient(API_TOKEN, API_URL);
  
  try {
    const response = await client.senseSingle(PROTOCOL_ID, 'Hello world');
    
    assertType(response.score, 'number', 'score is a number');
    assert(response.fidelity !== undefined, 'fidelity is present');
    console.log(`    Score: ${response.score.toFixed(4)}`);
    console.log(`    Fidelity: ${response.fidelity.index.toFixed(4)} (sufficient: ${response.fidelity.sufficient})`);
    // Short content should have lower fidelity
    console.log(`    Note: Short content may have low fidelity — this is expected`);
  } catch (error: unknown) {
    const err = error as Error;
    // 422 is acceptable for insufficient content
    if (err.message.includes('422')) {
      console.log(`  ✓ Got expected 422 for insufficient content`);
      passed++;
    } else {
      console.error(`  ✗ Short content sense failed: ${err.message}`);
      failed++;
    }
  }
}

async function testInvalidToken(): Promise<void> {
  section('Invalid token — should return 401/403');

  const client = new IBFClient('invalid-token-xxx', API_URL);
  
  try {
    await client.senseSingle(PROTOCOL_ID, 'Test content for auth check');
    console.error(`  ✗ Should have thrown an auth error`);
    failed++;
  } catch (error: unknown) {
    const err = error as Error;
    assert(
      err.message.includes('401') || err.message.includes('403'),
      `Got auth error: ${err.message.substring(0, 80)}`
    );
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          @blankstate/mcp — API Integration Tests            ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  API URL : ${API_URL.padEnd(48)}║`);
  console.log(`║  Token   : ${(API_TOKEN.substring(0, 20) + '...').padEnd(48)}║`);
  console.log(`║  Protocol: ${PROTOCOL_ID.substring(0, 48).padEnd(48)}║`);
  console.log(`║  Proto15 : ${PROTOCOL_ID_15.substring(0, 48).padEnd(48)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await testParseProtocolId();
  await testHealthCheck();
  await testStatus();
  await testSenseSingle();
  await testSenseSGM15();
  await testSenseMultiple();
  await testSenseWithShortContent();
  await testInvalidToken();

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
