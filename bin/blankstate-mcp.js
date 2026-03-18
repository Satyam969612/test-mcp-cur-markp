#!/usr/bin/env node
/**
 * @blankstate/mcp CLI entry point
 * 
 * This script starts the Blankstate MCP server.
 * Explicitly calls main() since the isMainModule guard in index.ts
 * won't match when invoked via this bin wrapper.
 */

import('../dist/index.js')
  .then(({ main }) => main())
  .catch((error) => {
    console.error('[blankstate] Failed to start:', error.message || error);
    process.exit(1);
  });
