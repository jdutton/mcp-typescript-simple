# @mcp-typescript-simple/tools-basic

**Example MCP Tool Pack** - Basic tools for demonstration and testing

## Purpose

This package provides simple, example MCP tools that serve multiple purposes:

1. **Example**: Demonstrate how to build MCP tools with the framework
2. **Testing**: Validate the framework functionality
3. **Reference**: Provide a starting point for building your own tools

⚠️ **Note**: These tools are intentionally simple and have no real-world utility beyond serving as examples and test fixtures.

## Tools Included

### `hello`
Greets a user by name

**Input**:
- `name` (string): Name of the person to greet

**Example**:
```typescript
const result = await basicTools.call('hello', { name: 'World' });
// Returns: "Hello, World! 👋"
```

### `echo`
Echoes back the provided message

**Input**:
- `message` (string): Message to echo back

**Example**:
```typescript
const result = await basicTools.call('echo', { message: 'Test' });
// Returns: "Echo: Test"
```

### `current-time`
Returns the current server timestamp in ISO 8601 format

**Input**: None

**Example**:
```typescript
const result = await basicTools.call('current-time', {});
// Returns: "Current time: 2025-10-20T12:34:56.789Z"
```

## Usage

```typescript
import { basicTools } from '@mcp-typescript-simple/tools-basic';

// Get all tools as MCP Tool list
const tools = basicTools.list();

// Invoke a tool
const result = await basicTools.call('hello', { name: 'Alice' });

// Use individual tools
import { helloTool } from '@mcp-typescript-simple/tools-basic';
const result = await helloTool.handler({ name: 'Bob' });
```

## Building Your Own Tool Pack

Use this package as a template for creating domain-specific tool packs:

1. Define tools using `defineTool()` from the framework
2. Create a registry and add your tools
3. Export both the registry and individual tools
4. Add comprehensive tests

See the source code for implementation details.

## License

MIT
