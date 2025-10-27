/**
 * OCSF Authentication Event Builder
 *
 * Fluent builder for creating type-safe OCSF Authentication events (Class 3002).
 */

import type {
  AuthenticationEvent,
  AuthenticationActivityId,
  AuthProtocolId,
  LogonTypeId,
  AuthenticationFactor,
  DigitalCertificate,
  Service,
} from '../types/authentication.js';
import type {
  SeverityId,
  StatusId,
  Metadata,
  User,
  Session,
  NetworkEndpoint,
  Device,
  Actor,
  Cloud,
  Process,
  HTTPRequest,
  APIDetails,
} from '../types/base.js';
import {
  getAuthenticationTypeUid,
  getAuthenticationActivityName,
  getAuthProtocolName,
} from '../types/authentication.js';

/**
 * Builder for constructing OCSF Authentication events
 */
export class AuthenticationEventBuilder {
  private readonly event: Partial<AuthenticationEvent>;

  constructor(activityId: AuthenticationActivityId) {
    const typeUid = getAuthenticationTypeUid(activityId);
    const activityName = getAuthenticationActivityName(activityId);

    this.event = {
      class_uid: 3002,
      class_name: 'Authentication',
      category_uid: 3,
      category_name: 'Identity & Access Management',
      activity_id: activityId,
      activity_name: activityName,
      type_uid: typeUid,
      type_name: `Authentication: ${activityName}`,
      time: Date.now(),
      severity_id: 1 as SeverityId, // Informational by default
      severity: 'Informational',
      metadata: {
        version: '1.3.0',
      },
    };
  }

  /**
   * Set the user being authenticated (required)
   */
  user(user: User): this {
    this.event.user = user;
    return this;
  }

  /**
   * Set severity level
   */
  severity(severityId: SeverityId, severity?: string): this {
    this.event.severity_id = severityId;
    if (severity) {
      this.event.severity = severity;
    }
    return this;
  }

  /**
   * Set event status
   */
  status(statusId: StatusId, statusCode?: string, statusDetail?: string): this {
    this.event.status_id = statusId;
    if (statusCode) {
      this.event.status_code = statusCode;
    }
    if (statusDetail) {
      this.event.status_detail = statusDetail;
    }
    return this;
  }

  /**
   * Set event message
   */
  message(message: string): this {
    this.event.message = message;
    return this;
  }

  /**
   * Set authentication session
   */
  session(session: Session): this {
    this.event.session = session;
    return this;
  }

  /**
   * Set if remote connection
   */
  isRemote(remote: boolean): this {
    this.event.is_remote = remote;
    return this;
  }

  /**
   * Set if MFA was used
   */
  isMfa(mfa: boolean): this {
    this.event.is_mfa = mfa;
    return this;
  }

  /**
   * Set authentication protocol
   */
  authProtocol(protocolId: AuthProtocolId): this {
    this.event.auth_protocol_id = protocolId;
    return this;
  }

  /**
   * Set logon type
   */
  logonType(logonTypeId: LogonTypeId): this {
    this.event.logon_type_id = logonTypeId;
    return this;
  }

  /**
   * Add authentication factors
   */
  authFactors(factors: AuthenticationFactor[]): this {
    this.event.auth_factors = factors;
    return this;
  }

  /**
   * Set digital certificate
   */
  certificate(cert: DigitalCertificate): this {
    this.event.certificate = cert;
    return this;
  }

  /**
   * Set destination endpoint
   */
  dstEndpoint(endpoint: NetworkEndpoint): this {
    this.event.dst_endpoint = endpoint;
    return this;
  }

  /**
   * Set service
   */
  service(service: Service): this {
    this.event.service = service;
    return this;
  }

  /**
   * Set source endpoint
   */
  srcEndpoint(endpoint: NetworkEndpoint): this {
    this.event.src_endpoint = endpoint;
    return this;
  }

  /**
   * Set device
   */
  device(device: Device): this {
    this.event.device = device;
    return this;
  }

  /**
   * Set actor
   */
  actor(actor: Actor): this {
    this.event.actor = actor;
    return this;
  }

  /**
   * Set cloud environment
   */
  cloud(cloud: Cloud): this {
    this.event.cloud = cloud;
    return this;
  }

  /**
   * Set logon process
   */
  logonProcess(process: Process): this {
    this.event.logon_process = process;
    return this;
  }

  /**
   * Set HTTP request details
   */
  httpRequest(request: HTTPRequest): this {
    this.event.http_request = request;
    return this;
  }

  /**
   * Set API details
   */
  api(api: APIDetails): this {
    this.event.api = api;
    return this;
  }

  /**
   * Set if cleartext auth
   */
  isCleartext(cleartext: boolean): this {
    this.event.is_cleartext = cleartext;
    return this;
  }

  /**
   * Set if new logon
   */
  isNewLogon(newLogon: boolean): this {
    this.event.is_new_logon = newLogon;
    return this;
  }

  /**
   * Set failure reason
   */
  failureReason(reason: string): this {
    this.event.failure_reason = reason;
    return this;
  }

  /**
   * Add metadata
   */
  withMetadata(metadata: Partial<Metadata>): this {
    this.event.metadata = {
      ...this.event.metadata!,
      ...metadata,
    };
    return this;
  }

  /**
   * Set duration
   */
  duration(ms: number): this {
    this.event.duration = ms;
    return this;
  }

  /**
   * Set start and end times
   */
  timeRange(startTime: number, endTime: number): this {
    this.event.start_time = startTime;
    this.event.end_time = endTime;
    this.event.duration = endTime - startTime;
    return this;
  }

  /**
   * Set timezone offset
   */
  timezoneOffset(offset: number): this {
    this.event.timezone_offset = offset;
    return this;
  }

  /**
   * Add unmapped custom attributes
   */
  unmapped(data: Record<string, unknown>): this {
    this.event.unmapped = {
      ...this.event.unmapped,
      ...data,
    };
    return this;
  }

  /**
   * Build the final event
   * @throws Error if required fields are missing
   */
  build(): AuthenticationEvent {
    // Validate required fields
    if (!this.event.user) {
      throw new Error('User is required for Authentication event');
    }

    // Type assertion is safe because we've validated required fields
    return this.event as AuthenticationEvent;
  }
}

/**
 * Create a new Authentication event builder for Logon activity
 */
export function logonEvent(): AuthenticationEventBuilder {
  return new AuthenticationEventBuilder(1); // AuthenticationActivityId.Logon
}

/**
 * Create a new Authentication event builder for Logoff activity
 */
export function logoffEvent(): AuthenticationEventBuilder {
  return new AuthenticationEventBuilder(2); // AuthenticationActivityId.Logoff
}

/**
 * Create a new Authentication event builder with custom activity
 */
export function authenticationEvent(
  activityId: AuthenticationActivityId,
): AuthenticationEventBuilder {
  return new AuthenticationEventBuilder(activityId);
}
