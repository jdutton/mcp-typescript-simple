/**
 * OCSF API Activity Event Builder
 *
 * Fluent builder for creating type-safe OCSF API Activity events (Class 6003).
 */

import type {
  APIActivityEvent,
  APIActivityId,
  API,
  ResourceDetails,
} from '../types/api-activity.js';
import type {
  SeverityId,
  Actor,
  NetworkEndpoint,
  Cloud,
  HTTPRequest,
  HTTPResponse,
} from '../types/base.js';
import {
  getAPIActivityTypeUid,
  getAPIActivityName,
} from '../types/api-activity.js';
import { BaseOCSFEventBuilder } from './base-event-builder.js';
import { randomUUID } from 'node:crypto';

/**
 * Builder for constructing OCSF API Activity events
 */
export class APIActivityEventBuilder extends BaseOCSFEventBuilder<APIActivityEvent, APIActivityEventBuilder> {
  protected readonly event: Partial<APIActivityEvent>;

  constructor(activityId: APIActivityId) {
    super();
    const typeUid = getAPIActivityTypeUid(activityId);
    const activityName = getAPIActivityName(activityId);

    this.event = {
      class_uid: 6003,
      class_name: 'API Activity',
      category_uid: 6,
      category_name: 'Application Activity',
      activity_id: activityId,
      activity_name: activityName,
      type_uid: typeUid,
      type_name: `API Activity: ${activityName}`,
      time: Date.now(),
      severity_id: 1 as SeverityId, // Informational by default
      severity: 'Informational',
      metadata: {
        version: '1.3.0',
        uid: randomUUID(), // Unique event ID for correlation
      },
    };
  }

  /**
   * Set the actor performing the API call (required)
   */
  actor(actor: Actor): this {
    this.event.actor = actor;
    return this;
  }

  /**
   * Set API call details (required)
   */
  api(api: API): this {
    this.event.api = api;
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
   * Set HTTP response details
   */
  httpResponse(response: HTTPResponse): this {
    this.event.http_response = response;
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
   * Set destination endpoint
   */
  dstEndpoint(endpoint: NetworkEndpoint): this {
    this.event.dst_endpoint = endpoint;
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
   * Add resources being accessed
   */
  resources(resources: ResourceDetails[]): this {
    this.event.resources = resources;
    return this;
  }

  /**
   * Add a single resource
   */
  resource(resource: ResourceDetails): this {
    if (!this.event.resources) {
      this.event.resources = [];
    }
    this.event.resources.push(resource);
    return this;
  }

  /**
   * Set connection info
   */
  connectionInfo(direction?: string, protocolName?: string, protocolVer?: string): this {
    this.event.connection_info = {
      direction,
      protocol_name: protocolName,
      protocol_ver: protocolVer,
    };
    return this;
  }

  /**
   * Set TLS/SSL details
   */
  tls(version?: string, cipher?: string): this {
    this.event.tls = {
      version,
      cipher,
    };
    return this;
  }

  /**
   * Set proxy details
   */
  proxy(hostname?: string, ip?: string, port?: number): this {
    this.event.proxy = {
      hostname,
      ip,
      port,
    };
    return this;
  }

  /**
   * Set event count (for aggregated events)
   */
  count(count: number): this {
    this.event.count = count;
    return this;
  }

  /**
   * Build the final event
   * @throws Error if required fields are missing
   */
  build(): APIActivityEvent {
    // Validate required fields
    if (!this.event.actor) {
      throw new Error('Actor is required for API Activity event');
    }
    if (!this.event.api) {
      throw new Error('API details are required for API Activity event');
    }

    // Type assertion is safe because we've validated required fields
    return this.event as APIActivityEvent;
  }
}

/**
 * Create a new API Activity event builder for Create operation
 */
export function createAPIEvent(): APIActivityEventBuilder {
  return new APIActivityEventBuilder(1); // APIActivityId.Create
}

/**
 * Create a new API Activity event builder for Read operation
 */
export function readAPIEvent(): APIActivityEventBuilder {
  return new APIActivityEventBuilder(2); // APIActivityId.Read
}

/**
 * Create a new API Activity event builder for Update operation
 */
export function updateAPIEvent(): APIActivityEventBuilder {
  return new APIActivityEventBuilder(3); // APIActivityId.Update
}

/**
 * Create a new API Activity event builder for Delete operation
 */
export function deleteAPIEvent(): APIActivityEventBuilder {
  return new APIActivityEventBuilder(4); // APIActivityId.Delete
}

/**
 * Create a new API Activity event builder with custom activity
 */
export function apiActivityEvent(
  activityId: APIActivityId,
): APIActivityEventBuilder {
  return new APIActivityEventBuilder(activityId);
}
