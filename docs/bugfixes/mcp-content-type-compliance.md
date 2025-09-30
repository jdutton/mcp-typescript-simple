# Bug Fix: MCP Content Type Specification Compliance

## Issue

**Date**: 2025-09-30
**Severity**: Critical
**Symptom**: Summarize tool throwing Zod validation error with message "receiving type: 'json' in content array but expects type: 'text'"

## Root Cause

All LLM tools (`chat`, `analyze`, `summarize`, `explain`) were returning invalid content type `type: "json"` in error responses, which violates the MCP specification.

**MCP Specification** only supports these content types:
- `type: "text"` - Text content
- `type: "image"` - Image content
- `type: "resource"` - Resource content
- `type: "resource_link"` - Resource link

**Invalid usage** (before fix):
```typescript
return {
  content: [
    { type: 'text', text: 'Error message' },
    { type: 'json', json: { error: errorPayload } }  // ❌ INVALID!
  ]
};
```

## Why It Manifested with Summarize Tool

The `summarize` tool defaults to using the **Gemini provider** (`gemini-1.5-flash`), which was unavailable in the user's environment (no `GOOGLE_API_KEY` configured). When the tool failed and returned an error response with invalid `type: "json"` content, the MCP SDK's Zod validator rejected it.

The `analyze` tool worked because it uses **OpenAI** by default, which was properly configured in the user's environment, so it never hit the error path.

## Fix Applied

### 1. Removed Invalid JSON Content Type

**Files Modified:**
- `src/tools/llm/chat.ts`
- `src/tools/llm/analyze.ts`
- `src/tools/llm/summarize.ts`
- `src/tools/llm/explain.ts`
- `src/server/mcp-setup.ts`

**Changed error responses to text-only** (MCP spec compliant):
```typescript
return {
  content: [
    {
      type: 'text',
      text: `Summarization failed: ${errorMessage}\n\nError details:\n- Tool: summarize\n- Code: SUMMARIZE_TOOL_ERROR`
    }
  ]
};
```

### 2. Updated Type Definitions

**Changed** `ToolResponse` type from:
```typescript
type ToolResponse = {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'json'; json: unknown }  // ❌ Invalid
  >;
};
```

**To**:
```typescript
type ToolResponse = {
  content: Array<{ type: 'text'; text: string }>;  // ✅ Valid
};
```

### 3. Updated Unit Tests

**File**: `test/unit/tools/llm/tools-error.test.ts`

**Changed** from checking for JSON content to verifying text-only responses:
```typescript
// Before: Expected invalid JSON content
const jsonError = extractJsonError(result);
expect(jsonError).toBeDefined();
expect(jsonError?.json.error.tool).toBe(tool);

// After: Verify MCP-compliant text content
expect(result.content).toHaveLength(1);
const firstContent = result.content[0]!;
expect(firstContent.type).toBe('text');
expect('text' in firstContent && firstContent.text).toContain('failed');
```

## Testing

### Unit Tests
- ✅ All 446 LLM tool tests passing
- ✅ Error handling tests updated and passing
- ✅ Type checking passes (`npm run build`)

### Manual Testing Required
User should retest with Claude Code to verify:
1. `summarize` tool now returns proper error message when Gemini unavailable
2. Error is readable and helpful (not Zod validation error)
3. All tools work correctly with configured providers

## Impact

**Positive:**
- MCP specification compliance restored
- Better error messages for users (human-readable text instead of validation errors)
- Type safety improved (no invalid content types in codebase)
- All tools now handle errors consistently

**Breaking Changes:**
- None - error responses still return `content` array with error information
- Format changed from structured JSON to formatted text, but remains parseable

## Prevention

**Future Guidelines:**
1. Only use MCP-specified content types: `text`, `image`, `resource`, `resource_link`
2. Include structured error information in text format (key-value pairs)
3. Test error paths with missing API keys to catch validation issues
4. Reference MCP SDK types for content structure validation

## Related Documentation

- **MCP Specification**: https://github.com/modelcontextprotocol/specification
- **MCP SDK Types**: `node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts`
- **Test Coverage**: `test/unit/tools/llm/tools-error.test.ts`

## Resolution

**Status**: Fixed and tested
**Commit**: [To be added after commit]
**PR**: [To be added after PR creation]