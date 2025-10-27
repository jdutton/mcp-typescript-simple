/**
 * OCSF Authentication Event (Class 3002)
 *
 * Authentication event class for logon/logoff activities and ticket operations.
 * Category: Identity & Access Management (3)
 *
 * Reference: https://schema.ocsf.io/1.3.0/classes/authentication
 */

import type {
  BaseEvent,
  Session,
  User,
  NetworkEndpoint,
  Process,
  HTTPRequest,
  APIDetails,
} from './base.js';

/**
 * Authentication activity types
 */
export enum AuthenticationActivityId {
  Unknown = 0,
  Logon = 1,
  Logoff = 2,
  AuthenticationTicket = 3,
  ServiceTicketRequest = 4,
  ServiceTicketRenew = 5,
  Preauth = 6,
  Other = 99,
}

/**
 * Authentication protocol types
 */
export enum AuthProtocolId {
  Unknown = 0,
  NTLM = 1,
  Kerberos = 2,
  Digest = 3,
  OpenID = 4,
  SAML = 5,
  OAuth2 = 6,
  PAP = 7,
  CHAP = 8,
  EAP = 9,
  RADIUS = 10,
  Other = 99,
}

/**
 * Logon type classification
 */
export enum LogonTypeId {
  Unknown = 0,
  System = 1,
  Interactive = 2,
  Network = 3,
  Batch = 4,
  OSService = 5,
  Unlock = 6,
  NetworkCleartext = 7,
  NewCredentials = 8,
  RemoteInteractive = 9,
  CachedInteractive = 10,
  CachedRemoteInteractive = 11,
  CachedUnlock = 12,
  Other = 99,
}

/**
 * Authentication factor types for MFA
 */
export interface AuthenticationFactor {
  /** Factor type (e.g., "Password", "TOTP", "SMS", "Biometric") */
  type: string;

  /** Factor result (e.g., "Success", "Failure") */
  result?: string;

  /** Factor provider */
  provider?: string;

  /** Factor device */
  device?: {
    name?: string;
    type?: string;
    uid?: string;
  };
}

/**
 * Digital certificate used in authentication
 */
export interface DigitalCertificate {
  /** Certificate serial number */
  serial_number?: string;

  /** Certificate subject */
  subject?: string;

  /** Certificate issuer */
  issuer?: string;

  /** Certificate fingerprints */
  fingerprints?: Array<{
    algorithm: string;
    value: string;
  }>;

  /** Certificate creation time */
  created_time?: number;

  /** Certificate expiration time */
  expiration_time?: number;

  /** Certificate version */
  version?: string;
}

/**
 * Service being accessed
 */
export interface Service {
  /** Service name */
  name: string;

  /** Service unique identifier */
  uid?: string;

  /** Service version */
  version?: string;

  /** Service labels */
  labels?: string[];
}


/**
 * Authentication Event (OCSF Class 3002)
 */
export interface AuthenticationEvent extends BaseEvent {
  /** Class UID is always 3002 for Authentication */
  class_uid: 3002;

  /** Category UID is always 3 for Identity & Access Management */
  category_uid: 3;

  /** Activity ID indicating authentication activity type */
  activity_id: AuthenticationActivityId;

  /** Type UID: class_uid * 100 + activity_id (300200-300299) */
  type_uid: number;

  /** User being authenticated (required) */
  user: User;

  /** Authentication session */
  session?: Session;

  /** Is this a remote connection */
  is_remote?: boolean;

  /** Was multi-factor authentication used */
  is_mfa?: boolean;

  /** Authentication protocol used */
  auth_protocol_id?: AuthProtocolId;

  /** Logon type classification */
  logon_type_id?: LogonTypeId;

  /** Authentication factors used (for MFA) */
  auth_factors?: AuthenticationFactor[];

  /** Digital certificate used in authentication */
  certificate?: DigitalCertificate;

  /** Target endpoint being accessed */
  dst_endpoint?: NetworkEndpoint;

  /** Service being accessed */
  service?: Service;

  /** Source endpoint of authentication attempt */
  src_endpoint?: NetworkEndpoint;

  /** Device initiating authentication */
  device?: {
    name?: string;
    type?: string;
    hostname?: string;
    os?: {
      name: string;
      version?: string;
    };
  };

  /** Logon process details */
  logon_process?: Process;

  /** HTTP request details (for web auth) */
  http_request?: HTTPRequest;

  /** API details (for programmatic auth) */
  api?: APIDetails;

  /** Was cleartext authentication used */
  is_cleartext?: boolean;

  /** Is this a new logon (vs cached) */
  is_new_logon?: boolean;

  /** Authentication failure reason */
  failure_reason?: string;
}

/**
 * Create type UID from activity ID
 */
export function getAuthenticationTypeUid(
  activityId: AuthenticationActivityId,
): number {
  return 3002 * 100 + activityId;
}

/**
 * Get activity name from activity ID
 */
export function getAuthenticationActivityName(
  activityId: AuthenticationActivityId,
): string {
  switch (activityId) {
    case AuthenticationActivityId.Unknown:
      return 'Unknown';
    case AuthenticationActivityId.Logon:
      return 'Logon';
    case AuthenticationActivityId.Logoff:
      return 'Logoff';
    case AuthenticationActivityId.AuthenticationTicket:
      return 'Authentication Ticket';
    case AuthenticationActivityId.ServiceTicketRequest:
      return 'Service Ticket Request';
    case AuthenticationActivityId.ServiceTicketRenew:
      return 'Service Ticket Renew';
    case AuthenticationActivityId.Preauth:
      return 'Preauth';
    case AuthenticationActivityId.Other:
      return 'Other';
    default:
      return 'Unknown';
  }
}

/**
 * Get protocol name from protocol ID
 */
export function getAuthProtocolName(protocolId: AuthProtocolId): string {
  switch (protocolId) {
    case AuthProtocolId.Unknown:
      return 'Unknown';
    case AuthProtocolId.NTLM:
      return 'NTLM';
    case AuthProtocolId.Kerberos:
      return 'Kerberos';
    case AuthProtocolId.Digest:
      return 'Digest';
    case AuthProtocolId.OpenID:
      return 'OpenID';
    case AuthProtocolId.SAML:
      return 'SAML';
    case AuthProtocolId.OAuth2:
      return 'OAuth 2.0';
    case AuthProtocolId.PAP:
      return 'PAP';
    case AuthProtocolId.CHAP:
      return 'CHAP';
    case AuthProtocolId.EAP:
      return 'EAP';
    case AuthProtocolId.RADIUS:
      return 'RADIUS';
    case AuthProtocolId.Other:
      return 'Other';
    default:
      return 'Unknown';
  }
}
