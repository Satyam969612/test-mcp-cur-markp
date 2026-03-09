#!/usr/bin/env node

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';

console.log();
console.log(`${CYAN}${BOLD}  ┌─────────────────────────────────────────────────────────────┐${RESET}`);
console.log(`${CYAN}${BOLD}  │                                                             │${RESET}`);
console.log(`${CYAN}${BOLD}  │${RESET}${WHITE}${BOLD}   BLANKSTATE MCP SERVER                                    ${RESET}${CYAN}${BOLD}│${RESET}`);
console.log(`${CYAN}${BOLD}  │${RESET}${WHITE}   Protocol-based sensing for autonomous AI agents           ${RESET}${CYAN}${BOLD}│${RESET}`);
console.log(`${CYAN}${BOLD}  │                                                             │${RESET}`);
console.log(`${CYAN}${BOLD}  │${RESET}${DIM}   Tools exposed:                                            ${RESET}${CYAN}${BOLD}│${RESET}`);
console.log(`${CYAN}${BOLD}  │${RESET}     ${WHITE}bks_sense${RESET}${DIM}       Measure interactions against protocols  ${RESET}${CYAN}${BOLD}│${RESET}`);
console.log(`${CYAN}${BOLD}  │${RESET}     ${WHITE}bks_validate${RESET}${DIM}    Pre-validate agent actions              ${RESET}${CYAN}${BOLD}│${RESET}`);
console.log(`${CYAN}${BOLD}  │${RESET}     ${WHITE}bks_status${RESET}${DIM}      API health, ICS balance, protocols     ${RESET}${CYAN}${BOLD}│${RESET}`);
console.log(`${CYAN}${BOLD}  │                                                             │${RESET}`);
console.log(`${CYAN}${BOLD}  │${RESET}${DIM}   Set BLANKSTATE_API_TOKEN and BLANKSTATE_PROTOCOLS          ${RESET}${CYAN}${BOLD}│${RESET}`);
console.log(`${CYAN}${BOLD}  │${RESET}${DIM}   https://blankstate.ai                                     ${RESET}${CYAN}${BOLD}│${RESET}`);
console.log(`${CYAN}${BOLD}  │                                                             │${RESET}`);
console.log(`${CYAN}${BOLD}  └─────────────────────────────────────────────────────────────┘${RESET}`);
console.log();
