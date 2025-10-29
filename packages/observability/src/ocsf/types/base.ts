/**
 * OCSF Base Event Types
 *
 * Common fields shared by all OCSF events based on OCSF 1.3.0 specification.
 * Reference: https://schema.ocsf.io/1.3.0
 */

/**
 * Severity levels for OCSF events
 */
export enum SeverityId {
  Unknown = 0,
  Informational = 1,
  Low = 2,
  Medium = 3,
  High = 4,
  Critical = 5,
  Fatal = 6,
  Other = 99,
}

/**
 * Event status outcomes
 */
export enum StatusId {
  Unknown = 0,
  Success = 1,
  Failure = 2,
  Other = 99,
}

/**
 * Metadata object containing event metadata
 */
export interface Metadata {
  /** Event version (e.g., "1.3.0") */
  version: string;

  /** Product or service name */
  product?: {
    name: string;
    version?: string;
    vendor_name?: string;
  };

  /** Event labels for categorization */
  labels?: string[];

  /** Unique event ID */
  uid?: string;

  /** Event correlation ID for grouping related events */
  correlation_uid?: string;

  /** Sequence number for ordering */
  sequence?: number;

  /** Original event time from source system */
  logged_time?: number;

  /** Time event was processed/normalized */
  processed_time?: number;
}

/**
 * Actor object describing who performed the action
 */
export interface Actor {
  /** User performing the action */
  user?: User;

  /** Process performing the action */
  process?: Process;

  /** Session information */
  session?: Session;

  /** Authorization details */
  authorizations?: Authorization[];
}

/**
 * User object
 */
export interface User {
  /** User name */
  name?: string;

  /** User ID */
  uid?: string;

  /** User type (e.g., "User", "Admin", "System") */
  type?: string;

  /** User domain */
  domain?: string;

  /** Email address */
  email_addr?: string;

  /** Full name */
  full_name?: string;

  /** User groups */
  groups?: Group[];

  /** User account details */
  account?: Account;
}

/**
 * Account object
 */
export interface Account {
  /** Account type (e.g., "AWS Account", "Azure Subscription") */
  type?: string;

  /** Account identifier */
  uid?: string;

  /** Account name */
  name?: string;
}

/**
 * Group object
 */
export interface Group {
  /** Group name */
  name: string;

  /** Group ID */
  uid?: string;

  /** Group type */
  type?: string;
}

/**
 * Process object
 */
export interface Process {
  /** Process name */
  name?: string;

  /** Process ID */
  pid?: number;

  /** Command line */
  cmd_line?: string;

  /** Process file path */
  file?: File;

  /** Parent process */
  parent_process?: Process;
}

/**
 * File object
 */
export interface File {
  /** File name */
  name: string;

  /** File path */
  path?: string;

  /** File type */
  type?: string;

  /** File size in bytes */
  size?: number;

  /** File hashes */
  hashes?: Hash[];
}

/**
 * Hash object
 */
export interface Hash {
  /** Hash algorithm (e.g., "SHA-256", "MD5") */
  algorithm: string;

  /** Hash value */
  value: string;
}

/**
 * Session object
 */
export interface Session {
  /** Session ID */
  uid: string;

  /** Session issuer */
  issuer?: string;

  /** Session created time */
  created_time?: number;

  /** Session expiration time */
  expiration_time?: number;

  /** Is the session remote */
  is_remote?: boolean;
}

/**
 * Authorization object
 */
export interface Authorization {
  /** Decision (e.g., "Allowed", "Denied") */
  decision?: string;

  /** Policy details */
  policy?: {
    name?: string;
    uid?: string;
    version?: string;
  };
}

/**
 * Cloud environment object
 */
export interface Cloud {
  /** Cloud provider (e.g., "AWS", "Azure", "GCP") */
  provider?: string;

  /** Cloud region */
  region?: string;

  /** Cloud account */
  account?: Account;

  /** Project ID (GCP) or Subscription (Azure) */
  project_uid?: string;
}

/**
 * Network Endpoint object
 */
export interface NetworkEndpoint {
  /** IP address */
  ip?: string;

  /** Port number */
  port?: number;

  /** Hostname */
  hostname?: string;

  /** Domain */
  domain?: string;

  /** MAC address */
  mac?: string;

  /** Geographic location */
  location?: Location;
}

/**
 * Location object
 */
export interface Location {
  /** City */
  city?: string;

  /** State/Province */
  region?: string;

  /** Country */
  country?: string;

  /** Coordinates */
  coordinates?: [number, number]; // [latitude, longitude]
}

/**
 * Device object
 */
export interface Device {
  /** Device name */
  name?: string;

  /** Device type */
  type?: string;

  /** Device hostname */
  hostname?: string;

  /** Operating system */
  os?: OperatingSystem;

  /** Network interfaces */
  network_interfaces?: NetworkInterface[];
}

/**
 * Operating System object
 */
export interface OperatingSystem {
  /** OS name (e.g., "Linux", "Windows") */
  name: string;

  /** OS version */
  version?: string;

  /** OS edition */
  edition?: string;

  /** OS build */
  build?: string;
}

/**
 * Network Interface object
 */
export interface NetworkInterface {
  /** Interface name */
  name?: string;

  /** IP address */
  ip?: string;

  /** MAC address */
  mac?: string;

  /** Interface type */
  type?: string;
}

/**
 * OSINT (Open Source Intelligence) object
 */
export interface OSINT {
  /** OSINT source name */
  name: string;

  /** Reputation score */
  reputation?: {
    score: number;
    base_score?: number;
  };

  /** Threat classification */
  threats?: Threat[];
}

/**
 * Threat object
 */
export interface Threat {
  /** Threat name */
  name?: string;

  /** Threat type */
  type?: string;

  /** Severity */
  severity_id?: SeverityId;

  /** Confidence level */
  confidence?: number;
}

/**
 * Base event interface that all OCSF events extend
 */
export interface BaseEvent {
  /** Event class UID (e.g., 3002 for Authentication, 6003 for API Activity) */
  class_uid: number;

  /** Human-readable class name */
  class_name?: string;

  /** Category UID (e.g., 3 for IAM, 6 for Application Activity) */
  category_uid: number;

  /** Human-readable category name */
  category_name?: string;

  /** Activity ID indicating what happened */
  activity_id: number;

  /** Human-readable activity name */
  activity_name?: string;

  /** Type UID (class_uid * 100 + activity_id) */
  type_uid: number;

  /** Type name */
  type_name?: string;

  /** Event severity */
  severity_id: SeverityId;

  /** Human-readable severity */
  severity?: string;

  /** Event occurrence time (Unix epoch milliseconds) */
  time: number;

  /** Event status */
  status_id?: StatusId;

  /** Human-readable status */
  status?: string;

  /** Status code from source */
  status_code?: string;

  /** Additional status details */
  status_detail?: string;

  /** Event message */
  message?: string;

  /** Event metadata */
  metadata: Metadata;

  /** Cloud environment */
  cloud?: Cloud;

  /** OSINT data */
  osint?: OSINT[];

  /** Actor who performed the action */
  actor?: Actor;

  /** Device where action originated */
  device?: Device;

  /** Source network endpoint */
  src_endpoint?: NetworkEndpoint;

  /** Destination network endpoint */
  dst_endpoint?: NetworkEndpoint;

  /** Start time for event period */
  start_time?: number;

  /** End time for event period */
  end_time?: number;

  /** Timezone offset in minutes */
  timezone_offset?: number;

  /** Event count (for aggregated events) */
  count?: number;

  /** Duration in milliseconds */
  duration?: number;

  /** Raw event data */
  raw_data?: string;

  /** Unmapped custom attributes */
  unmapped?: Record<string, unknown>;

  /** Observable objects extracted from event */
  observables?: Observable[];

  /** Enrichment data from external sources */
  enrichments?: Enrichment[];
}

/**
 * Observable object for extracted indicators
 */
export interface Observable {
  /** Observable name */
  name: string;

  /** Observable type (e.g., "IP Address", "Domain", "File Hash") */
  type: string;

  /** Observable value */
  value: string;

  /** Reputation */
  reputation?: {
    score: number;
    base_score?: number;
  };
}

/**
 * Enrichment data from external sources
 */
export interface Enrichment {
  /** Enrichment data */
  data: Record<string, unknown>;

  /** Enrichment name */
  name: string;

  /** Enrichment provider */
  provider?: string;

  /** Enrichment type */
  type?: string;

  /** Enrichment value */
  value?: string;
}

/**
 * HTTP request details (shared by multiple event classes)
 */
export interface HTTPRequest {
  /** HTTP method */
  method?: string;

  /** Request URL */
  url?: {
    url_string: string;
    hostname?: string;
    path?: string;
    port?: number;
    scheme?: string;
    query_string?: string;
  };

  /** HTTP version */
  version?: string;

  /** Request headers */
  headers?: Record<string, string>;

  /** User agent */
  user_agent?: string;

  /** Referrer */
  referrer?: string;

  /** Request body length */
  length?: number;
}

/**
 * HTTP response details
 */
export interface HTTPResponse {
  /** HTTP status code */
  code?: number;

  /** Response message */
  message?: string;

  /** Response headers */
  headers?: Record<string, string>;

  /** Response body length */
  length?: number;

  /** Latency in milliseconds */
  latency?: number;
}

/**
 * API details for programmatic operations
 */
export interface APIDetails {
  /** API operation */
  operation?: string;

  /** API service name */
  service?: {
    name: string;
    version?: string;
  };

  /** API version */
  version?: string;

  /** API request details */
  request?: {
    uid?: string;
    data?: Record<string, unknown>;
  };

  /** API response details */
  response?: {
    code?: number;
    message?: string;
    data?: Record<string, unknown>;
    error?: string;
    error_message?: string;
    /** Response body length in bytes */
    length?: number;
  };
}
