/**
 * @blankstate/mcp - Content Extractor
 * 
 * Extracts relevant content from tool call arguments for Protocol analysis.
 */

import type { ExtractedContent, ToolType } from '../types/index.js';

/**
 * Tool name to ToolType mapping
 */
const TOOL_TYPE_MAP: Record<string, ToolType> = {
  // Exec tools
  'execute_command': 'exec',
  'exec': 'exec',
  'bash': 'exec',
  'shell': 'exec',
  'run_command': 'exec',
  'terminal': 'exec',
  
  // Write tools
  'file_write': 'write',
  'write_file': 'write',
  'write': 'write',
  'apply_patch': 'write',
  'patch': 'write',
  'edit_file': 'write',
  'create_file': 'write',
  
  // Browser tools
  'browser': 'browser',
  'browser_navigate': 'browser',
  'browser_action': 'browser',
  'web': 'browser',
  'browse': 'browser',
  
  // Messaging tools
  'slack': 'messaging',
  'discord': 'messaging',
  'telegram': 'messaging',
  'whatsapp': 'messaging',
  'email': 'messaging',
  'send_email': 'messaging',
  'send_message': 'messaging',
  'message': 'messaging',
  'agent_send': 'messaging',
  'post': 'messaging',
};

/**
 * Get the ToolType for a given tool name
 */
export function getToolType(toolName: string): ToolType | undefined {
  const normalized = toolName.toLowerCase().replace(/[^a-z_]/g, '');
  return TOOL_TYPE_MAP[normalized];
}

/**
 * Check if a tool should be wrapped based on Protocol configuration
 */
export function shouldWrapTool(toolName: string, configuredTools: ToolType[]): boolean {
  if (configuredTools.includes('all')) {
    return true;
  }
  
  const toolType = getToolType(toolName);
  if (!toolType) {
    return false;
  }
  
  return configuredTools.includes(toolType);
}

/**
 * Extract content from tool arguments for Protocol analysis
 */
export function extractContent(toolName: string, args: unknown): ExtractedContent {
  const toolType = getToolType(toolName);
  
  if (!toolType || typeof args !== 'object' || args === null) {
    return {
      content: JSON.stringify(args),
      metadata: {
        tool: toolName,
        extractedFields: ['raw'],
      },
    };
  }

  const argsObj = args as Record<string, unknown>;
  
  switch (toolType) {
    case 'exec':
      return extractExecContent(toolName, argsObj);
    case 'write':
      return extractWriteContent(toolName, argsObj);
    case 'browser':
      return extractBrowserContent(toolName, argsObj);
    case 'messaging':
      return extractMessagingContent(toolName, argsObj);
    default:
      return {
        content: JSON.stringify(args),
        metadata: {
          tool: toolName,
          extractedFields: ['raw'],
        },
      };
  }
}

/**
 * Extract content from exec-type tools
 */
function extractExecContent(toolName: string, args: Record<string, unknown>): ExtractedContent {
  const parts: string[] = [];
  const extractedFields: string[] = [];

  // Common field names for commands
  const commandFields = ['command', 'cmd', 'script', 'bash', 'shell'];
  for (const field of commandFields) {
    if (typeof args[field] === 'string') {
      parts.push(`command=${args[field]}`);
      extractedFields.push(field);
      break;
    }
  }

  // Working directory
  const wdFields = ['workdir', 'cwd', 'working_directory', 'directory', 'dir'];
  for (const field of wdFields) {
    if (typeof args[field] === 'string') {
      parts.push(`workdir=${args[field]}`);
      extractedFields.push(field);
      break;
    }
  }

  // Environment variables (check for sensitive keys)
  if (args.env && typeof args.env === 'object') {
    const envKeys = Object.keys(args.env as object);
    const sensitiveKeys = envKeys.filter(k => 
      /secret|token|key|password|credential|auth/i.test(k)
    );
    if (sensitiveKeys.length > 0) {
      parts.push(`env_sensitive_keys=[${sensitiveKeys.join(',')}]`);
      extractedFields.push('env');
    }
  }

  return {
    content: parts.join(', '),
    metadata: {
      tool: toolName,
      extractedFields,
    },
  };
}

/**
 * Extract content from write-type tools
 */
function extractWriteContent(toolName: string, args: Record<string, unknown>): ExtractedContent {
  const parts: string[] = [];
  const extractedFields: string[] = [];

  // File path
  const pathFields = ['path', 'file', 'filepath', 'filename', 'target'];
  for (const field of pathFields) {
    if (typeof args[field] === 'string') {
      parts.push(`path=${args[field]}`);
      extractedFields.push(field);
      break;
    }
  }

  // Content (truncated for analysis)
  const contentFields = ['content', 'contents', 'data', 'text', 'body'];
  for (const field of contentFields) {
    if (typeof args[field] === 'string') {
      const content = args[field] as string;
      // Truncate long content but include start and end
      if (content.length > 500) {
        parts.push(`content_preview="${content.substring(0, 200)}...[truncated]...${content.substring(content.length - 100)}"`);
      } else {
        parts.push(`content="${content}"`);
      }
      extractedFields.push(field);
      break;
    }
  }

  // Patch/diff
  if (typeof args.patch === 'string' || typeof args.diff === 'string') {
    const patch = (args.patch ?? args.diff) as string;
    parts.push(`patch="${patch.substring(0, 300)}${patch.length > 300 ? '...' : ''}"`);
    extractedFields.push('patch');
  }

  return {
    content: parts.join(', '),
    metadata: {
      tool: toolName,
      extractedFields,
    },
  };
}

/**
 * Extract content from browser-type tools
 */
function extractBrowserContent(toolName: string, args: Record<string, unknown>): ExtractedContent {
  const parts: string[] = [];
  const extractedFields: string[] = [];

  // URL
  const urlFields = ['url', 'href', 'link', 'target_url'];
  for (const field of urlFields) {
    if (typeof args[field] === 'string') {
      parts.push(`url=${args[field]}`);
      extractedFields.push(field);
      break;
    }
  }

  // Action
  if (typeof args.action === 'string') {
    parts.push(`action=${args.action}`);
    extractedFields.push('action');
  }

  // Form data
  if (args.form_data && typeof args.form_data === 'object') {
    const formKeys = Object.keys(args.form_data as object);
    parts.push(`form_fields=[${formKeys.join(',')}]`);
    extractedFields.push('form_data');
  }

  // Input text
  if (typeof args.text === 'string' || typeof args.input === 'string') {
    const text = (args.text ?? args.input) as string;
    parts.push(`input="${text.substring(0, 200)}${text.length > 200 ? '...' : ''}"`);
    extractedFields.push('input');
  }

  return {
    content: parts.join(', '),
    metadata: {
      tool: toolName,
      extractedFields,
    },
  };
}

/**
 * Extract content from messaging-type tools
 */
function extractMessagingContent(toolName: string, args: Record<string, unknown>): ExtractedContent {
  const parts: string[] = [];
  const extractedFields: string[] = [];

  // Message content
  const msgFields = ['message', 'content', 'body', 'text'];
  for (const field of msgFields) {
    if (typeof args[field] === 'string') {
      parts.push(`message="${args[field]}"`);
      extractedFields.push(field);
      break;
    }
  }

  // Recipient(s)
  const recipientFields = ['to', 'recipient', 'recipients', 'target', 'channel'];
  for (const field of recipientFields) {
    if (args[field]) {
      if (Array.isArray(args[field])) {
        const recipients = args[field] as string[];
        parts.push(`recipients=[${recipients.length} targets: ${recipients.slice(0, 3).join(', ')}${recipients.length > 3 ? '...' : ''}]`);
      } else if (typeof args[field] === 'string') {
        parts.push(`recipient=${args[field]}`);
      }
      extractedFields.push(field);
      break;
    }
  }

  // Subject (for emails)
  if (typeof args.subject === 'string') {
    parts.push(`subject="${args.subject}"`);
    extractedFields.push('subject');
  }

  // Attachments
  if (args.attachments && Array.isArray(args.attachments)) {
    parts.push(`attachments=[${(args.attachments as unknown[]).length} files]`);
    extractedFields.push('attachments');
  }

  return {
    content: parts.join(', '),
    metadata: {
      tool: toolName,
      extractedFields,
    },
  };
}
