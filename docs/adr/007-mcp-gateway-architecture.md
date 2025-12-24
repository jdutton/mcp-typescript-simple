# ADR-007: MCP Gateway Architecture for Multi-Tenant Tool Federation

## Status
**DRAFT** - Architectural proposal pending implementation

## Context

### Problem Statement

The current mcp-typescript-simple framework provides a production-ready foundation for building individual MCP servers with OAuth authentication, horizontal scalability, and multi-transport support. However, enterprise environments increasingly require **MCP Gateway** capabilities to enable:

1. **Multi-tenant isolation**: Multiple organizations sharing infrastructure with strict data separation
2. **Tool federation**: Dynamic aggregation and routing of tools from multiple MCP servers
3. **Centralized access control**: Enterprise-grade RBAC across federated tool ecosystems
4. **Service discovery**: Automatic registration and health monitoring of MCP servers

**Real-World Use Cases:**

- **Enterprise SaaS Platforms**: Companies need to expose MCP tools to customers with tenant isolation
- **Tool Marketplaces**: Aggregating third-party MCP servers into unified catalogs
- **Multi-Team Environments**: Large organizations with separate teams managing different tool sets
- **API Gateway Pattern**: Centralizing authentication, rate limiting, and observability for MCP ecosystems

### Current Capabilities

mcp-typescript-simple already provides foundational infrastructure:

| Capability | Status | Notes |
|------------|--------|-------|
| **Horizontal Scalability** | ✅ Production | Redis-backed session reconstruction (ADR-003) |
| **Multi-Provider OAuth** | ✅ Production | Google, GitHub, Microsoft, Dynamic Client Registration (ADR-002) |
| **Encryption at Rest** | ✅ Production | AES-256-GCM, tenant-scoped keys (ADR-004) |
| **Session Management** | ✅ Production | Metadata-driven reconstruction, 30-min TTL |
| **Observability** | ✅ Production | OpenTelemetry, structured logging, distributed tracing (ADR-001) |
| **Multi-Transport** | ✅ Production | STDIO, Streamable HTTP, Vercel serverless |
| **API Documentation** | ✅ Production | OpenAPI 3.1, Swagger UI |

**Estimated Foundation Coverage**: ~80% of required gateway infrastructure already implemented.

### Gateway Capabilities Gap

Missing capabilities for full MCP Gateway functionality:

| Missing Capability | Priority | Description |
|-------------------|----------|-------------|
| **Multi-Tenancy** | P0 | Tenant and team-based isolation, resource scoping |
| **Tool Registry** | P0 | Centralized catalog of tools from federated servers |
| **Server Registry** | P0 | Dynamic MCP server registration and health monitoring |
| **Tool Routing** | P0 | Intelligent routing of tool calls to appropriate servers |
| **RBAC (Role-Based Access)** | P1 | Granular permissions for tools, servers, and tenants |
| **Rate Limiting** | P1 | Per-tenant quotas and throttling |
| **Tool Virtualization** | P2 | Expose non-MCP services (REST/gRPC) as MCP tools |

### Requirements

**Functional Requirements:**
1. Multi-tenant isolation with team-based organization hierarchies
2. Dynamic MCP server registration via API
3. Automatic tool discovery and catalog aggregation
4. Intelligent tool routing based on tenant context
5. Role-based access control for tools and servers
6. Per-tenant rate limiting and quota management
7. Health monitoring and circuit breaking for federated servers

**Non-Functional Requirements:**
1. **Scalability**: Support 1000+ concurrent tenants
2. **Performance**: <50ms tool routing latency (p95)
3. **Availability**: 99.9% uptime SLA
4. **Security**: Zero tenant data leakage, SOC-2 compliance
5. **Observability**: Distributed tracing across federated servers
6. **Backward Compatibility**: Existing single-server usage unchanged

## Decision

### Solution: Enhance mcp-typescript-simple as MCP Gateway

Extend the existing framework with gateway capabilities rather than adopting external gateway solutions.

### Architecture

#### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Multi-Tenant MCP Gateway                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Tenant A    │  │  Tenant B    │  │  Tenant C    │          │
│  │  (Org 1)     │  │  (Org 2)     │  │  (Org 3)     │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                  │
│         └──────────────────┴──────────────────┘                  │
│                            │                                      │
│                            ▼                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │          Gateway Core (mcp-typescript-simple)             │  │
│  ├───────────────────────────────────────────────────────────┤  │
│  │ • Multi-Tenancy Layer (tenant + team isolation)           │  │
│  │ • Tool Registry (federated catalog)                       │  │
│  │ • Server Registry (dynamic registration)                  │  │
│  │ • Tool Router (intelligent routing)                       │  │
│  │ • RBAC Engine (role-based permissions)                    │  │
│  │ • Rate Limiter (per-tenant quotas)                        │  │
│  │ • Observability (OpenTelemetry tracing)                   │  │
│  │ • Encryption (tenant-scoped AES-256-GCM)                  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                            │                                      │
│         ┌──────────────────┼──────────────────┐                  │
│         │                  │                  │                  │
│         ▼                  ▼                  ▼                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ MCP Server  │  │ MCP Server  │  │   Custom    │             │
│  │   Pool A    │  │   Pool B    │  │  Services   │             │
│  │             │  │             │  │             │             │
│  │• Tools 1-10 │  │• Tools 11-20│  │• REST APIs  │             │
│  │• Health OK  │  │• Health OK  │  │• gRPC APIs  │             │
│  │• Tenant A,B │  │• Tenant C   │  │• Wrapped    │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

#### Core Components

**1. Multi-Tenancy Layer**

Provides tenant and team-based isolation with hierarchical organization structures.

```typescript
interface Tenant {
  tenantId: string;           // Organization identifier
  name: string;               // Display name
  domain?: string;            // Email domain for auto-assignment
  maxUsers: number;           // License limit
  maxTeams: number;           // Organizational structure limit
  features: TenantFeatures;   // Feature flags per tenant
  subscription: {
    tier: 'basic' | 'professional' | 'enterprise';
    expiresAt: Date;
  };
  createdAt: Date;
}

interface Team {
  teamId: string;
  tenantId: string;           // Parent organization
  name: string;               // "Engineering Team", "Sales Team"
  members: TeamMember[];      // User assignments
  roles: TeamRole[];          // RBAC definitions
  resourceAccess: {           // Scoped access
    tools: string[];          // Allowed tool IDs
    servers: string[];        // Allowed server IDs
  };
}
```

**Data Model:**
- Tenants represent top-level organizations (customers, departments)
- Teams provide sub-organization grouping within tenants
- Users belong to one tenant, multiple teams
- Resource access (tools, servers) scoped at team level

**Storage:**
- PostgreSQL/Supabase for tenant/team/user metadata (with row-level security)
- Redis for cached tenant context (leveraging existing session patterns)
- Tenant-scoped encryption keys (extending ADR-004 infrastructure)

**2. Tool Registry**

Centralized catalog of tools from federated MCP servers with tenant-scoped visibility.

```typescript
interface ToolDefinition {
  toolId: string;             // Unique identifier
  name: string;               // Tool name (e.g., "analyze")
  description: string;        // User-facing description
  inputSchema: JSONSchema;    // MCP tool schema
  serverId: string;           // Source MCP server
  tenantId?: string;          // Tenant-specific tools
  teamId?: string;            // Team-specific tools
  visibility: 'public' | 'tenant' | 'team' | 'private';
  version: string;            // Semantic versioning
  metadata: {
    category: string[];       // ["AI", "Analysis"]
    tags: string[];           // ["llm", "text-processing"]
    requiresAuth: boolean;    // Authentication requirement
  };
}
```

**Operations:**
- Dynamic tool registration from federated servers
- Tenant-scoped tool discovery (query by visibility)
- Tool versioning support (v1, v2, breaking changes)
- Search and filtering (by category, tags, tenant)

**Storage:**
- Redis for tool catalog (high-performance lookups)
- PostgreSQL for tool versioning history and audit logs
- JSON Schema validation for tool definitions

**3. Server Registry**

Dynamic registration and health monitoring of federated MCP servers.

```typescript
interface MCPServerDefinition {
  serverId: string;           // Unique identifier
  name: string;               // Display name
  endpoint: string;           // HTTP endpoint or stdio command
  transport: 'stdio' | 'http';
  tenantId?: string;          // Tenant ownership (null = shared)
  healthCheck: {
    url: string;              // Health endpoint
    interval: number;         // Poll frequency (seconds)
    timeout: number;          // Request timeout
    status: 'healthy' | 'unhealthy' | 'unknown';
    lastCheck: Date;
    consecutiveFailures: number;
  };
  tools: ToolDefinition[];    // Advertised tools
  metadata: {
    version: string;          // Server version
    description: string;
    capabilities: string[];   // ["streaming", "oauth", "caching"]
  };
  createdAt: Date;
}
```

**Operations:**
- Server registration via REST API (POST /api/servers)
- Automatic tool discovery on registration
- Health check polling (configurable intervals)
- Circuit breaker pattern for unhealthy servers
- Server deregistration (DELETE /api/servers/:id)

**Health Monitoring:**
- Periodic health checks (default: 30 seconds)
- Exponential backoff for unhealthy servers
- Auto-deregister after N consecutive failures
- Metrics: uptime, latency, error rates

**4. Tool Router**

Intelligent routing of tool calls to appropriate MCP servers based on tenant context.

```typescript
class ToolGatewayRouter {
  async routeToolCall(
    tenantId: string,
    userId: string,
    toolName: string,
    params: unknown
  ): Promise<ToolCallResult> {
    // 1. Lookup tool in registry (tenant-scoped)
    const tool = await this.registry.getTool(tenantId, toolName);

    // 2. Validate user permissions (RBAC)
    await this.rbac.checkPermission(userId, 'tool:execute', tool.toolId);

    // 3. Get target MCP server
    const server = await this.registry.getServer(tool.serverId);

    // 4. Check server health
    if (server.healthCheck.status !== 'healthy') {
      throw new Error(`Server ${server.name} is unhealthy`);
    }

    // 5. Apply rate limiting
    await this.rateLimiter.checkQuota(tenantId, toolName);

    // 6. Route request to server
    const result = await this.invokeRemoteTool(server, toolName, params);

    // 7. Record metrics
    this.metrics.recordToolCall(tenantId, toolName, result.status);

    return result;
  }
}
```

**Routing Logic:**
- Tenant-scoped tool lookup (respects visibility)
- Permission checking before execution
- Health-aware routing (skip unhealthy servers)
- Rate limiting enforcement
- Distributed tracing (OpenTelemetry spans)

**5. RBAC Engine**

Role-based access control for tools, servers, and administrative operations.

```typescript
enum Permission {
  // Tool permissions
  TOOL_READ = 'tool:read',
  TOOL_EXECUTE = 'tool:execute',
  TOOL_REGISTER = 'tool:register',

  // Server permissions
  SERVER_READ = 'server:read',
  SERVER_REGISTER = 'server:register',
  SERVER_DELETE = 'server:delete',

  // Admin permissions
  TENANT_ADMIN = 'tenant:admin',
  USER_MANAGE = 'user:manage',
  TEAM_MANAGE = 'team:manage',
}

interface Role {
  roleId: string;
  name: string;               // "Developer", "Admin", "Viewer"
  permissions: Permission[];
  tenantId?: string;          // Tenant-specific roles
}
```

**Permission Model:**
- Roles assigned at team or user level
- Permissions checked before all operations
- Hierarchical: team roles + user roles combined
- Audit logging for permission checks

**6. Rate Limiter**

Per-tenant quotas and throttling to prevent abuse.

```typescript
interface RateLimitConfig {
  tenantId: string;
  limits: {
    requestsPerMinute: number;    // Global request limit
    toolCallsPerHour: number;     // Tool execution limit
    serverRegistrations: number;  // Max registered servers
  };
  enforcement: 'soft' | 'hard';   // Warning vs blocking
}
```

**Implementation:**
- Redis-backed rate limiting (sliding window)
- Per-tenant and per-tool quotas
- Graceful degradation (soft limits with warnings)
- Metrics and alerting for quota exhaustion

### Data Flow

#### Tool Call Flow

```
1. Client Request
   ↓
   POST /api/mcp
   {
     "method": "tools/call",
     "params": {
       "name": "analyze",
       "arguments": { "text": "..." }
     }
   }

2. Gateway Authentication (OAuth)
   ↓
   Extract: tenantId, userId from session (ADR-002, ADR-004)

3. Tool Lookup (Tool Registry)
   ↓
   Query: tools WHERE name='analyze' AND tenantId=X
   Result: { toolId, serverId, visibility, ... }

4. Permission Check (RBAC)
   ↓
   Check: user has 'tool:execute' permission for toolId

5. Server Lookup (Server Registry)
   ↓
   Query: servers WHERE serverId=Y
   Result: { endpoint, transport, healthCheck, ... }

6. Health Check (Circuit Breaker)
   ↓
   IF healthCheck.status != 'healthy' THEN fail-fast

7. Rate Limiting
   ↓
   Check: tenant quota for tool 'analyze'

8. Remote Tool Invocation (HTTP/STDIO)
   ↓
   POST {server.endpoint}/tools/call
   OR
   exec {server.command} with stdio transport

9. Response Handling
   ↓
   Record metrics, audit logs, return result to client
```

### Implementation Changes

#### New Packages

**`@mcp-typescript-simple/gateway`** - Core gateway logic
- Multi-tenancy layer
- Tool registry service
- Server registry service
- Tool router
- RBAC engine
- Rate limiter

**`@mcp-typescript-simple/gateway-admin`** - Admin UI/API
- Tenant management endpoints
- Team management endpoints
- Server registration API
- Tool catalog browser
- Analytics dashboard

**`@mcp-typescript-simple/gateway-client`** - Client SDK
- TypeScript SDK for gateway interaction
- Multi-tenant context management
- Tool discovery helpers
- Server registration helpers

#### Enhanced Packages

**`@mcp-typescript-simple/persistence`** - Data layer
- Tenant store (PostgreSQL)
- Team store (PostgreSQL)
- User store (PostgreSQL)
- Tool registry store (Redis + PostgreSQL)
- Server registry store (Redis + PostgreSQL)

**`@mcp-typescript-simple/auth`** - Authentication
- Tenant context extraction from OAuth sessions
- Team membership validation
- RBAC permission checking

**`@mcp-typescript-simple/observability`** - Monitoring
- Multi-tenant metrics (per-tenant request rates)
- Server health metrics (uptime, latency)
- Tool usage analytics (call counts, error rates)
- Distributed tracing across federated servers

### API Endpoints

**Tenant Management:**
- `POST /api/admin/tenants` - Create tenant
- `GET /api/admin/tenants` - List tenants
- `GET /api/admin/tenants/:id` - Get tenant details
- `PUT /api/admin/tenants/:id` - Update tenant
- `DELETE /api/admin/tenants/:id` - Delete tenant

**Team Management:**
- `POST /api/admin/teams` - Create team
- `GET /api/admin/teams` - List teams (tenant-scoped)
- `GET /api/admin/teams/:id` - Get team details
- `PUT /api/admin/teams/:id` - Update team
- `DELETE /api/admin/teams/:id` - Delete team

**Server Registry:**
- `POST /api/servers` - Register MCP server
- `GET /api/servers` - List servers (tenant-scoped)
- `GET /api/servers/:id` - Get server details
- `PUT /api/servers/:id` - Update server
- `DELETE /api/servers/:id` - Deregister server
- `POST /api/servers/:id/health` - Manual health check

**Tool Catalog:**
- `GET /api/tools` - List tools (tenant-scoped, filtered by visibility)
- `GET /api/tools/:id` - Get tool details
- `POST /api/tools/:id/execute` - Execute tool (proxied through router)

**RBAC:**
- `GET /api/admin/roles` - List roles
- `POST /api/admin/roles` - Create role
- `PUT /api/admin/users/:id/roles` - Assign roles to user

## Consequences

### Benefits

**✅ Enterprise-Grade Multi-Tenancy**
- Strict tenant isolation with tenant-scoped encryption (ADR-004)
- Team-based organization hierarchies
- Per-tenant feature flags and quotas
- SOC-2 compliance ready

**✅ Dynamic Tool Federation**
- Automatic tool discovery from registered servers
- Centralized tool catalog with search/filtering
- Tool versioning support (v1, v2, breaking changes)
- No hardcoded tool definitions

**✅ Intelligent Routing**
- Health-aware routing (skip unhealthy servers)
- Permission-based access control (RBAC)
- Rate limiting enforcement
- Distributed tracing across federated servers

**✅ Operational Excellence**
- Automatic health monitoring with circuit breakers
- Centralized observability (OpenTelemetry)
- Admin UI for tenant/team/server management
- Self-service server registration API

**✅ Backward Compatibility**
- Existing single-server usage unchanged
- Gateway features opt-in via configuration
- No breaking changes to existing APIs
- Gradual migration path

**✅ Developer Experience**
- TypeScript SDK for gateway interaction
- Comprehensive OpenAPI documentation
- Interactive Swagger UI for testing
- Example implementations and tutorials

### Risks and Mitigations

**Risk: Multi-Tenancy Complexity**
- **Impact**: Increased codebase complexity, potential for tenant data leakage
- **Mitigation**:
  - Comprehensive testing (50+ multi-tenancy tests)
  - Tenant-scoped encryption keys (ADR-004)
  - Row-level security in PostgreSQL (Supabase RLS)
  - Security audit before production launch

**Risk: Performance Overhead**
- **Impact**: Additional latency from routing, RBAC checks, rate limiting
- **Mitigation**:
  - Redis caching for tenant context and tool lookups
  - Target <50ms routing latency (p95)
  - Performance testing with 1000+ tenants
  - Horizontal scaling with load balancers

**Risk: Operational Complexity**
- **Impact**: More components to monitor, deploy, and maintain
- **Mitigation**:
  - Unified observability with OpenTelemetry (ADR-001)
  - Health monitoring with automatic alerting
  - Kubernetes deployment patterns
  - Comprehensive documentation

**Risk: Breaking Changes**
- **Impact**: Existing users face migration challenges
- **Mitigation**:
  - Backward compatibility guarantee
  - Gateway features opt-in via configuration
  - Migration guides and tooling
  - Semantic versioning (1.0.0 → 2.0.0)

### Performance Impact

**Expected Overhead:**
- Tool routing: ~10-20ms (Redis lookups + HTTP proxy)
- RBAC checks: ~5-10ms (Redis-cached permissions)
- Rate limiting: ~2-5ms (Redis counters)
- Total added latency: ~20-35ms (p95)

**Mitigation Strategies:**
- Aggressive caching (tenant context, tool definitions, permissions)
- Connection pooling for federated servers
- Async health checks (non-blocking)
- Horizontal scaling with stateless architecture

### Security Considerations

**Tenant Isolation:**
- Tenant-scoped encryption keys (ADR-004)
- Row-level security in PostgreSQL (Supabase RLS)
- Redis key prefixing (tenant namespace isolation)
- Audit logging for all cross-tenant operations

**RBAC Enforcement:**
- Permission checks before all operations
- Default deny (explicit permission required)
- Audit logging for permission checks
- Regular permission audits

**Network Security:**
- TLS for all federated server communication
- OAuth 2.1 for authentication (ADR-002)
- API rate limiting per tenant
- DDoS protection (Cloudflare, AWS Shield)

## Alternatives Considered

### Alternative 1: Adopt IBM MCP Context Forge

**Description**: Use IBM's open-source MCP gateway (Python-based) instead of building gateway capabilities.

**Pros:**
- ✅ Multi-tenancy already implemented (v0.9.0)
- ✅ Protocol translation (REST/gRPC → MCP)
- ✅ Federation capabilities (peer gateway discovery)
- ✅ Admin UI included (HTMX + Alpine.js)

**Cons:**
- ❌ No official IBM support ("you are responsible")
- ❌ Beta maturity with breaking changes (v0.9.0 multi-tenancy migration)
- ❌ Python-based (tech stack mismatch with TypeScript ecosystem)
- ❌ Generic gateway (not optimized for specific use cases)
- ❌ Database migration required for multi-tenancy
- ❌ Limited community adoption (niche project)

**Why Rejected:**
- **Maturity Risk**: No production support, breaking changes in recent versions
- **Tech Stack Mismatch**: Python vs TypeScript (different ecosystems)
- **Customization Difficulty**: Extending Python gateway harder than TypeScript
- **Adoption Risk**: Limited community, uncertain long-term support
- **Integration Cost**: Significant effort to adapt to existing infrastructure

**Source**: [IBM MCP Context Forge](https://ibm.github.io/mcp-context-forge/)

### Alternative 2: Adopt Microsoft MCP Gateway

**Description**: Use Microsoft's Kubernetes-native MCP gateway (Azure-focused) instead of building gateway capabilities.

**Pros:**
- ✅ Microsoft backing (more stable long-term)
- ✅ Kubernetes-native architecture (StatefulSets, headless services)
- ✅ Enterprise authentication (Entra ID / Azure AD)
- ✅ Production deployment patterns (Azure)

**Cons:**
- ❌ Alpha maturity (33 commits, 7 months old as of Dec 2025)
- ❌ Azure-centric architecture (vendor lock-in)
- ❌ Limited multi-tenancy (team-based, not full SaaS)
- ❌ StatefulSets complexity (operational overhead)
- ❌ No specialized features for niche industries

**Why Rejected:**
- **Maturity Risk**: Early-stage project with limited production deployments
- **Azure Lock-in**: Architecture tightly coupled to Azure services
- **Multi-Tenancy Gap**: Team-based model insufficient for SaaS use cases
- **Operational Complexity**: StatefulSets add deployment and scaling challenges
- **Customization Difficulty**: Azure-native patterns harder to adapt

**Source**: [Microsoft MCP Gateway GitHub](https://github.com/microsoft/mcp-gateway)

### Alternative 3: Build Standalone Gateway (Separate Project)

**Description**: Create entirely new project for gateway, separate from mcp-typescript-simple.

**Pros:**
- ✅ Clean separation of concerns
- ✅ Independent versioning and releases
- ✅ No backward compatibility constraints

**Cons:**
- ❌ Duplicate infrastructure (auth, encryption, observability)
- ❌ Longer time to market (build from scratch)
- ❌ Increased maintenance burden (two projects)
- ❌ Fragmented ecosystem (confusing for users)

**Why Rejected:**
- **Duplication**: 80% of required infrastructure already exists
- **Time to Market**: Longer development timeline vs enhancement
- **Maintenance Cost**: Two projects harder to maintain than one
- **User Confusion**: "Which project should I use?" problem

### Alternative 4: Microservices Architecture (Gateway as Separate Services)

**Description**: Build gateway as separate microservices (tenant service, tool service, routing service).

**Pros:**
- ✅ Independent scaling of components
- ✅ Technology diversity (different languages per service)
- ✅ Fault isolation

**Cons:**
- ❌ Distributed system complexity (network calls, latency)
- ❌ Operational overhead (deploy/monitor multiple services)
- ❌ Data consistency challenges (distributed transactions)
- ❌ Higher infrastructure costs

**Why Rejected:**
- **Complexity**: Not justified for initial gateway implementation
- **Performance**: Network calls between services add latency
- **Operations**: More services = more operational burden
- **Cost**: Higher infrastructure and maintenance costs
- **Preferred Path**: Start monolithic, extract services if needed later

### Why Enhancement is Preferred

**Strategic Advantages:**
1. **Leverage Existing Foundation**: 80% of infrastructure already built (encryption, observability, scalability)
2. **Faster Time to Market**: Enhancement approach reduces development timeline
3. **Full Control**: Own the entire stack, no vendor dependencies
4. **TypeScript Ecosystem**: Consistent tech stack, easier to maintain
5. **Backward Compatible**: Existing users unaffected, gradual migration path
6. **Community Growth**: Extends existing project vs fragmenting ecosystem

**Technical Fit:**
- Proven production-ready foundation (968 passing tests)
- Horizontal scalability patterns already implemented (ADR-003)
- Security infrastructure ready (ADR-004 encryption)
- Observability infrastructure ready (ADR-001 OpenTelemetry)
- OAuth infrastructure ready (ADR-002 client state preservation)

**Economic Analysis:**
- **Enhancement Approach**: Shorter development timeline leveraging existing infrastructure
- **Adoption Approach** (external gateway): Longer integration and hardening cycle
- **Risk**: Lower (proven foundation vs experimental external projects)

## References

### External MCP Gateway Solutions

**IBM MCP Context Forge:**
- **Documentation**: [https://ibm.github.io/mcp-context-forge/](https://ibm.github.io/mcp-context-forge/)
- **GitHub**: [https://github.com/IBM/mcp-context-forge](https://github.com/IBM/mcp-context-forge)
- **Maturity**: v0.9.0 (beta), no official support
- **Tech Stack**: Python, Redis, PostgreSQL
- **Key Features**: Multi-tenancy (breaking change in v0.9.0), protocol translation, federation

**Microsoft MCP Gateway:**
- **GitHub**: [https://github.com/microsoft/mcp-gateway](https://github.com/microsoft/mcp-gateway)
- **Azure Docs**: [Azure API Management MCP Overview](https://learn.microsoft.com/en-us/azure/api-management/mcp-server-overview)
- **Maturity**: Alpha (33 commits, created May 2025)
- **Tech Stack**: Kubernetes, Azure services, Entra ID
- **Key Features**: StatefulSets, session-aware routing, Azure integration

**MCP Gateway Landscape Analysis:**
- [Top 5 MCP Gateways of 2025](https://www.truefoundry.com/blog/best-mcp-gateways)
- [MCP Server vs Gateway Architecture Comparison](https://skywork.ai/blog/mcp-server-vs-mcp-gateway-comparison-2025/)

### Related ADRs

- **ADR-001**: OpenTelemetry Observability Architecture (tracing across federated servers)
- **ADR-002**: OAuth Client State Preservation (authentication for gateway users)
- **ADR-003**: Horizontal Scalability via Metadata Reconstruction (Redis-backed sessions)
- **ADR-004**: Encryption Infrastructure (tenant-scoped encryption keys)
- **ADR-005**: OCSF Structured Audit Events (audit logging for RBAC)

### MCP Protocol Specifications

- **MCP 1.18.0 Specification**: Core protocol for tool definitions and invocation
- **RFC 6749**: OAuth 2.0 Authorization Framework (gateway authentication)
- **RFC 7591**: OAuth 2.0 Dynamic Client Registration (server registration pattern)

## Decision Record

**Date**: 2025-12-15

**Participants**: Jeff Dutton (CTO), Claude Code (Strategic Analysis)

**Status**: **DRAFT** - Pending implementation and validation

**Next Steps**:
1. Community feedback on architectural proposal
2. Prototype implementation (multi-tenancy + tool registry)
3. Performance testing (1000+ tenants, <50ms routing latency)
4. Security audit (tenant isolation, RBAC enforcement)
5. Documentation and migration guides

**Review Date**: TBD (after prototype implementation)

## Project Planning

For implementation details, timelines, and engineering project plan, see:

**[TODO-MCP-GATEWAY.md](../../TODO-MCP-GATEWAY.md)**

This project plan includes:
- Phased implementation roadmap (P0, P1, P2 features)
- Engineering team structure and resource estimates
- Milestone timeline and deliverables
- Testing strategy and acceptance criteria
- Risk mitigation plans
- Success metrics and KPIs
