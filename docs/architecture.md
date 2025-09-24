# MCP TypeScript Simple Server Architecture

## Executive Summary

This is a production-ready Model Context Protocol (MCP) server implementation built with TypeScript, featuring dual-mode operation (STDIO + Streamable HTTP), multi-LLM integration, and comprehensive deployment options including Vercel serverless functions. The architecture supports both traditional MCP clients and modern web applications while maintaining type safety and operational excellence.

## System Architecture Overview

```
                    ┌─────────────────────────────────────────────────┐
                    │                MCP Clients                      │
                    │        (Claude Desktop, Web Apps, etc.)        │
                    └─────────────────┬───────────────────────────────┘
                                      │
                    ┌─────────────────▼───────────────────────────────┐
                    │              Transport Layer                    │
                    │   ┌─────────────────┐   ┌─────────────────┐     │
                    │   │  STDIO Transport│   │ Streamable HTTP │     │
                    │   │   (Traditional) │   │  (Web/Serverless)│     │
                    │   └─────────────────┘   └─────────────────┘     │
                    └─────────────────┬───────────────────────────────┘
                                      │
                    ┌─────────────────▼───────────────────────────────┐
                    │              MCP Server Core                    │
                    │  ┌─────────────────────────────────────────────┐ │
                    │  │         Shared Server Setup                 │ │
                    │  │    (Tool Registry & Request Handlers)      │ │
                    │  └─────────────────┬───────────────────────────┘ │
                    └──────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────▼───────────────────────────────┐
                    │                Tool Ecosystem                   │
                    │ ┌─────────────┐ ┌──────────────────────────────┐ │
                    │ │ Basic Tools │ │       LLM-Powered Tools      │ │
                    │ │ ┌─────────┐ │ │ ┌──────┐ ┌─────────┐ ┌─────┐ │ │
                    │ │ │ hello   │ │ │ │ chat │ │ analyze │ │ ... │ │ │
                    │ │ │ echo    │ │ │ │      │ │         │ │     │ │ │
                    │ │ │ time    │ │ │ └──────┘ └─────────┘ └─────┘ │ │
                    │ │ └─────────┘ │ └──────────────────────────────┘ │
                    │ └─────────────┘                │                │
                    └─────────────────────────────────┼────────────────┘
                                                      │
                    ┌─────────────────────────────────▼────────────────┐
                    │              LLM Provider Layer                 │
                    │  ┌─────────┐  ┌─────────┐  ┌─────────────────┐  │
                    │  │ Claude  │  │ OpenAI  │  │ Google Gemini   │  │
                    │  │(Anthropic)  │(ChatGPT)│  │   (Bard/PaLM)   │  │
                    │  └─────────┘  └─────────┘  └─────────────────┘  │
                    └──────────────────────────────────────────────────┘
```

## Deployment Architecture

### Traditional Deployment (STDIO Mode)
```
    ┌─────────────────┐       ┌───────────────────────────────┐
    │  Claude Desktop │──────▶│      MCP Server Process       │
    │   (MCP Client)  │       │   ┌─────────────────────────┐ │
    └─────────────────┘       │   │  StdioServerTransport   │ │
                              │   └─────────────────────────┘ │
    ┌─────────────────┐       │   ┌─────────────────────────┐ │
    │   Docker Host   │◀──────│   │     Tool Registry       │ │
    │   (Container)   │       │   └─────────────────────────┘ │
    └─────────────────┘       └───────────────────────────────┘
```

### Vercel Serverless Deployment (Streamable HTTP Mode)
```
    ┌─────────────────┐       ┌─────────────────────────────────┐
    │   Web Client    │──────▶│         Vercel Edge CDN         │
    │  (HTTP/SSE)     │       └─────────────────┬───────────────┘
    └─────────────────┘                         │
                                                │
    ┌─────────────────┐       ┌─────────────────▼───────────────┐
    │  MCP Inspector  │──────▶│      Vercel Serverless          │
    │   (Testing)     │       │   ┌─────────────────────────┐   │
    └─────────────────┘       │   │   /api/mcp.ts Function  │   │
                              │   │ ┌─────────────────────┐ │   │
    ┌─────────────────┐       │   │ │  Streamable HTTP    │ │   │
    │ Claude Code     │──────▶│   │ │    Transport        │ │   │
    │  Integration    │       │   │ └─────────────────────┘ │   │
    └─────────────────┘       │   └─────────────────────────┘   │
                              │   ┌─────────────────────────┐   │
                              │   │   Shared MCP Setup      │   │
                              │   │   (Tool Registry)       │   │
                              │   └─────────────────────────┘   │
                              └─────────────────────────────────┘
                                                │
                              ┌─────────────────▼───────────────┐
                              │     Additional Endpoints        │
                              │ /api/health  /api/auth  /api/admin│
                              └─────────────────────────────────┘
```

## Core Components

### 1. Dual Transport Layer
**Purpose**: Supports both traditional STDIO and modern HTTP transports

**STDIO Transport**:
- Direct process communication via stdin/stdout
- JSON-RPC 2.0 over process pipes
- Ideal for local development and Claude Desktop integration
- Zero network overhead

**Streamable HTTP Transport**:
- HTTP POST with streaming support
- Content-type negotiation (JSON/SSE)
- CORS-enabled for web applications
- OAuth authentication support

**Architectural Decision**: Dual transport enables maximum compatibility while supporting modern web architectures and serverless deployment.

### 2. Shared Server Setup - src/server/mcp-setup.ts
**Purpose**: Common server configuration and tool registration

**Key Functions**:
- `setupMCPServer()`: Creates and configures MCP server instance
- Tool registry initialization with type-safe schemas
- LLM provider detection and configuration
- Environment-aware setup (API keys, OAuth)

**Design Pattern**: Factory pattern with dependency injection for environment-specific configurations.

### 3. Enhanced Tool Ecosystem

**Basic Tools** (Always Available):
- **hello**: Personalized greeting with name parameter
- **echo**: Message reflection for testing/debugging
- **current-time**: System time retrieval

**LLM-Powered Tools** (API Key Dependent):
- **chat**: Interactive AI assistant with provider/model selection
- **analyze**: Deep text analysis (sentiment, themes, structure)
- **summarize**: Text summarization with format options
- **explain**: Educational explanations with adaptive complexity

**Provider Strategy**: Each LLM tool has optimized defaults but supports runtime provider/model override for maximum flexibility.

### 4. Multi-LLM Provider Layer
**Supported Providers**:
- **Claude (Anthropic)**: Haiku (speed), Sonnet (balance), Opus (capability)
- **OpenAI**: GPT-3.5-turbo, GPT-4, GPT-4-turbo, GPT-4o variants
- **Google Gemini**: 1.0-pro, 1.5-flash, 1.5-pro

**Type Safety**: Compile-time validation of provider/model combinations with runtime fallbacks.

## Vercel Serverless Architecture

### API Function Structure
```
api/
├── mcp.ts              # Main MCP protocol handler
├── health.ts           # Health checks and deployment info
├── auth.ts             # OAuth authentication flows
├── admin.ts            # Administration and metrics
└── (shared imports from build/)
```

### Request Flow in Serverless Mode
```
Incoming Request:
┌─────────────┐    ┌──────────────┐    ┌─────────────────┐
│   Client    │───▶│ Vercel Edge  │───▶│ Serverless      │
│  (HTTP/SSE) │    │     CDN      │    │   Function      │
└─────────────┘    └──────────────┘    └─────────────────┘
                                                │
Function Execution:                             │
┌─────────────┐    ┌──────────────┐    ┌───────▼─────────┐
│   Tool      │◀───│  MCP Server  │◀───│ Request Handler │
│ Execution   │    │    Setup     │    │ (mcp.ts)       │
└─────────────┘    └──────────────┘    └─────────────────┘
                                                │
Response Streaming:                             │
┌─────────────┐    ┌──────────────┐    ┌───────▼─────────┐
│   Client    │◀───│   Vercel     │◀───│ Streamable      │
│  Response   │    │  Response    │    │   Response      │
└─────────────┘    └──────────────┘    └─────────────────┘
```

## Authentication Architecture

### OAuth Integration
**Supported Providers**: Google, GitHub, Microsoft, Generic OAuth
**Flow**: Authorization Code with PKCE for security
**Session Management**: Stateless JWT tokens
**Security**: HTTPS-only, secure redirect validation

```
OAuth Flow:
┌─────────────┐    ┌──────────────┐    ┌─────────────────┐
│   Client    │───▶│ /api/auth    │───▶│ OAuth Provider  │
│             │    │  (initiate)  │    │  (Google/etc.)  │
└─────────────┘    └──────────────┘    └─────────────────┘
        │                                       │
        │          Redirect with Code           │
        ▼                                       ▼
┌─────────────┐    ┌──────────────┐    ┌─────────────────┐
│   Client    │◀───│ /api/auth    │◀───│    Token        │
│ (Authenticated)   │ (callback)   │    │   Exchange      │
└─────────────┘    └──────────────┘    └─────────────────┘
```

## Data Flow Architecture

### Traditional STDIO Flow
```
Client Request:
┌─────────┐    ┌──────────────┐    ┌─────────────┐    ┌─────────────┐
│ Client  │───▶│   Transport  │───▶│   Server    │───▶│    Tool     │
│ Request │    │   (stdio)    │    │   Handler   │    │  Execution  │
└─────────┘    └──────────────┘    └─────────────┘    └─────────────┘
                                                             │
Server Response:                                             │
┌─────────┐    ┌──────────────┐    ┌─────────────┐    ┌─────▼─────┐
│ Client  │◀───│   Transport  │◀───│   Server    │◀───│   Tool    │
│Response │    │   (stdio)    │    │   Response  │    │  Result   │
└─────────┘    └──────────────┘    └─────────────┘    └───────────┘
```

### Streamable HTTP Flow
```
HTTP Request:
┌─────────┐    ┌──────────────┐    ┌─────────────┐    ┌─────────────┐
│ Client  │───▶│   Vercel     │───▶│ MCP Handler │───▶│    Tool     │
│(Browser)│    │   Function   │    │ (mcp.ts)    │    │  Execution  │
└─────────┘    └──────────────┘    └─────────────┘    └─────────────┘
                                                             │
Streaming Response:                                          │
┌─────────┐    ┌──────────────┐    ┌─────────────┐    ┌─────▼─────┐
│ Client  │◀───│   Vercel     │◀───│ Streamable  │◀───│   Tool    │
│(Stream) │    │   Response   │    │   HTTP      │    │  Result   │
└─────────┘    └──────────────┘    └─────────────┘    └───────────┘
```

## Technical Implementation Details

### Protocol Compliance
- **MCP Version**: Latest specification compliance with Streamable HTTP support
- **JSON-RPC 2.0**: Standard protocol with correlation IDs
- **Schema Validation**: Zod-based runtime type checking
- **Error Handling**: Structured error responses with HTTP status codes

### TypeScript Configuration
- **Target**: ES2022 for Node.js 22+ compatibility
- **Module System**: ES modules with strict type checking
- **Build Output**: Compiled JavaScript to `build/` directory for serverless import
- **Development**: tsx for fast TypeScript execution

### Environment Management
- **Tiered Secrets**: Environment variables → .env files → fallback
- **Runtime Detection**: Automatic LLM provider availability detection
- **Configuration Validation**: Startup-time validation with clear error messages

## Deployment Strategies

### Local Development
```bash
# Traditional STDIO mode
npm run dev:stdio

# Streamable HTTP mode (no auth)
npm run dev:sse

# Vercel local development
npm run dev:vercel

# Full OAuth testing
npm run dev:oauth
```

### Production Deployment Options

#### Docker Container (Traditional)
- **Base Image**: Alpine Linux 3.20
- **Runtime**: Node.js 22+
- **Process Management**: Direct node execution
- **Resource Optimization**: Multi-stage build

#### Vercel Serverless (Modern)
- **Functions**: Independent API endpoints
- **Auto-scaling**: Based on demand
- **Global CDN**: Edge deployment
- **Monitoring**: Built-in observability

#### Hybrid Deployment
- Traditional server for Claude Desktop integration
- Serverless functions for web application APIs
- Shared codebase with different entry points

## Scalability and Team Considerations

### Code Organization
- **Shared Core**: Common MCP setup logic in src/server/
- **Transport Abstraction**: Clean separation between STDIO and HTTP
- **Tool Modularity**: Each tool is independently implementable and testable
- **Type Safety**: Full TypeScript coverage prevents runtime errors

### Extension Strategy
**Adding New Tools**:
1. Define tool schema and parameters in setupMCPServer
2. Implement pure function with error handling
3. Add to tool registry
4. Update documentation and tests

**Adding New Transports**:
1. Implement transport interface
2. Create entry point (e.g., new API function)
3. Reuse setupMCPServer for consistency

### Team Scaling Implications
- **Low Complexity**: New team members can contribute tools quickly
- **Testing Strategy**: Each component is independently testable
- **Code Review**: Clear boundaries and shared patterns
- **Knowledge Transfer**: Architecture documentation and examples

## Performance Characteristics

### STDIO Mode Performance
- **Concurrent Requests**: Single-threaded, sequential processing
- **Memory Footprint**: ~50-80MB including LLM libraries
- **Startup Time**: <3 seconds cold start
- **Request Latency**: <10ms for basic tools, 500ms-2s for LLM tools

### Serverless Mode Performance
- **Cold Start**: <1 second (Vercel Node.js runtime)
- **Concurrent Requests**: Auto-scaling based on demand
- **Memory Limit**: 1024MB (Vercel Free), configurable
- **Execution Timeout**: 10s (Free), 60s (Pro)

### LLM Provider Performance
- **Claude**: 500ms-2s typical response time
- **OpenAI**: 300ms-1.5s typical response time
- **Gemini**: 400ms-1.8s typical response time

## Security Considerations

### Transport Security
- **STDIO**: Process isolation, no network exposure
- **HTTP**: HTTPS-only, CORS configuration, rate limiting
- **OAuth**: Secure redirect validation, PKCE flow

### Data Protection
- **API Keys**: Environment variable storage, no logging
- **User Data**: Stateless processing, no persistent storage
- **Input Validation**: Schema-based validation for all tool parameters

### Deployment Security
- **Container**: Minimal attack surface, non-root user
- **Serverless**: Automatic security updates, function isolation
- **Network**: No inbound network requirements for STDIO mode

## Monitoring and Observability

### Built-in Monitoring
- **Health Endpoints**: Real-time health status and configuration
- **Request Logging**: Unique request IDs with timing information
- **Error Tracking**: Structured error responses with context
- **Performance Metrics**: Memory usage, response times

### Production Monitoring Strategy
- **Vercel Analytics**: Built-in function performance monitoring
- **Custom Metrics**: Tool usage patterns and success rates
- **Error Alerting**: Failed tool executions and transport errors
- **Resource Monitoring**: Memory usage trends and cold start frequency

## Risk Assessment and Mitigation

### Current Risks
1. **LLM API Dependencies**: External service availability
   - *Mitigation*: Multi-provider fallback, graceful degradation
2. **API Rate Limiting**: Provider usage limits
   - *Mitigation*: Request caching, usage monitoring
3. **Cold Start Latency**: Serverless function initialization
   - *Mitigation*: Keep-alive strategies, Vercel Pro for faster starts

### Security Risks
1. **API Key Exposure**: Credential leakage
   - *Mitigation*: Environment-only storage, no logging
2. **Input Injection**: Malicious tool parameters
   - *Mitigation*: Schema validation, input sanitization
3. **OAuth Vulnerabilities**: Authentication bypass
   - *Mitigation*: PKCE flow, secure redirect validation

## Success Metrics

### Technical Metrics
- **Availability**: >99.5% uptime across all transports
- **Response Time**: <2s p95 for LLM tools, <100ms for basic tools
- **Error Rate**: <1% tool execution failures
- **Resource Efficiency**: <100MB memory per instance

### Team Metrics
- **Tool Development Velocity**: New tool in <4 hours
- **Code Review Speed**: <24 hours average
- **Release Frequency**: Weekly deployments with CI/CD
- **Technical Debt**: <4 hours monthly maintenance

## Migration and Evolution Path

### Phase 1: Current State ✅
- Dual-mode transport (STDIO + HTTP)
- Multi-LLM integration with type safety
- Vercel serverless deployment
- Comprehensive testing and CI/CD

### Phase 2: Enhanced Operations
- Advanced caching strategies (Redis integration)
- Rate limiting and quota management
- Enhanced observability and alerting
- Performance optimization

### Phase 3: Advanced Features
- Plugin architecture for third-party tools
- Advanced authentication (SSO, RBAC)
- Tool marketplace and discovery
- Multi-tenant isolation

### Phase 4: Enterprise Scale
- Distributed tool execution
- Advanced security controls and audit
- Custom LLM provider integration
- Enterprise deployment options

## Conclusion

This MCP server architecture successfully balances simplicity with production readiness, supporting both traditional MCP clients and modern web applications. The dual-mode transport layer, comprehensive LLM integration, and flexible deployment options provide a robust foundation for team productivity and system scaling.

The architecture empowers development teams to focus on tool functionality while providing clear evolution paths for both feature expansion and operational scale. The combination of type safety, comprehensive testing, and multiple deployment strategies ensures reliable operation across diverse environments.