/**
 * OCSF API Activity Event (Class 6003)
 *
 * API activity event class for tracking API calls, tool invocations, and service operations.
 * Category: Application Activity (6)
 *
 * Reference: https://schema.ocsf.io/1.3.0/classes/api_activity
 */

/* eslint-disable no-unused-vars */
// Enums are part of OCSF specification and exported for library consumers

import type {
  BaseEvent,
  Actor,
  NetworkEndpoint,
  HTTPRequest,
  HTTPResponse,
} from './base.js';

/**
 * API activity types (CRUD operations)
 */
export enum APIActivityId {
  Unknown = 0,
  Create = 1,
  Read = 2,
  Update = 3,
  Delete = 4,
  Other = 99,
}

/**
 * API object with call details
 */
export interface API {
  /** API operation (e.g., "mcp.tools.call", "mcp.resources.read") */
  operation: string;

  /** API service details */
  service?: {
    /** Service name (e.g., "MCP Server", "OpenAI API") */
    name: string;

    /** Service version */
    version?: string;

    /** Service labels */
    labels?: string[];
  };

  /** API version (e.g., "1.0", "2024-01") */
  version?: string;

  /** API request details */
  request?: {
    /** Unique request ID */
    uid?: string;

    /** Request data/parameters */
    data?: Record<string, unknown>;

    /** Request flags */
    flags?: string[];
  };

  /** API response details */
  response?: {
    /** HTTP status code or equivalent */
    code?: number;

    /** Response message */
    message?: string;

    /** Response data */
    data?: Record<string, unknown>;

    /** Error code if failed */
    error?: string;

    /** Error message if failed */
    error_message?: string;

    /** Response flags */
    flags?: string[];

    /** Response body length in bytes */
    length?: number;
  };
}


/**
 * Resource details being accessed
 */
export interface ResourceDetails {
  /** Resource name (e.g., tool name, file path) */
  name?: string;

  /** Resource type (e.g., "MCP Tool", "API Endpoint") */
  type?: string;

  /** Resource unique identifier */
  uid?: string;

  /** Resource owner */
  owner?: {
    name?: string;
    uid?: string;
  };

  /** Resource labels */
  labels?: string[];

  /** Resource data */
  data?: Record<string, unknown>;

  /** Resource criticality */
  criticality?: string;
}

/**
 * API Activity Event (OCSF Class 6003)
 */
export interface APIActivityEvent extends BaseEvent {
  /** Class UID is always 6003 for API Activity */
  class_uid: 6003;

  /** Category UID is always 6 for Application Activity */
  category_uid: 6;

  /** Activity ID indicating CRUD operation type */
  activity_id: APIActivityId;

  /** Type UID: class_uid * 100 + activity_id (600300-600399) */
  type_uid: number;

  /** Actor performing the API call (required) */
  actor: Actor;

  /** API call details (required) */
  api: API;

  /** HTTP request details */
  http_request?: HTTPRequest;

  /** HTTP response details */
  http_response?: HTTPResponse;

  /** Source endpoint making the API call */
  src_endpoint?: NetworkEndpoint;

  /** Destination endpoint receiving the API call */
  dst_endpoint?: NetworkEndpoint;

  /** Resources being accessed */
  resources?: ResourceDetails[];

  /** Connection info */
  connection_info?: {
    /** Connection direction (e.g., "Inbound", "Outbound") */
    direction?: string;

    /** Connection protocol name */
    protocol_name?: string;

    /** Connection protocol version */
    protocol_ver?: string;
  };

  /** TLS/SSL details */
  tls?: {
    /** TLS version */
    version?: string;

    /** Cipher suite */
    cipher?: string;

    /** Certificate details */
    certificate?: {
      serial_number?: string;
      subject?: string;
      issuer?: string;
      fingerprints?: Array<{
        algorithm: string;
        value: string;
      }>;
    };
  };

  /** Proxy details if request went through proxy */
  proxy?: {
    /** Proxy hostname */
    hostname?: string;

    /** Proxy IP */
    ip?: string;

    /** Proxy port */
    port?: number;
  };

  /** Web application firewall (WAF) information */
  web_resources?: {
    /** URL requested */
    url_string?: string;

    /** HTTP method */
    http_method?: string;

    /** Response code */
    http_status?: number;
  };
}

/**
 * Create type UID from activity ID
 */
export function getAPIActivityTypeUid(activityId: APIActivityId): number {
  return 6003 * 100 + activityId;
}

/**
 * Get activity name from activity ID
 */
export function getAPIActivityName(activityId: APIActivityId): string {
  switch (activityId) {
    case APIActivityId.Unknown:
      return 'Unknown';
    case APIActivityId.Create:
      return 'Create';
    case APIActivityId.Read:
      return 'Read';
    case APIActivityId.Update:
      return 'Update';
    case APIActivityId.Delete:
      return 'Delete';
    case APIActivityId.Other:
      return 'Other';
    default:
      return 'Unknown';
  }
}

/**
 * Map HTTP method to activity ID
 */
export function httpMethodToActivityId(method: string): APIActivityId {
  switch (method.toUpperCase()) {
    case 'POST':
      return APIActivityId.Create;
    case 'GET':
    case 'HEAD':
      return APIActivityId.Read;
    case 'PUT':
    case 'PATCH':
      return APIActivityId.Update;
    case 'DELETE':
      return APIActivityId.Delete;
    default:
      return APIActivityId.Other;
  }
}
