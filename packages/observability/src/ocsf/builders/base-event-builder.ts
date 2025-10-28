/**
 * Base OCSF Event Builder
 *
 * Shared functionality for all OCSF event builders.
 * Eliminates code duplication across authentication, API activity, and other event types.
 */

import type {
  SeverityId,
  StatusId,
  Metadata,
} from '../types/base.js';

/**
 * Minimum event structure that all OCSF events share
 */
export interface BaseOCSFEvent {
  severity_id?: SeverityId;
  severity?: string;
  status_id?: StatusId;
  status_code?: string;
  status_detail?: string;
  message?: string;
  metadata?: Metadata;
  duration?: number;
  start_time?: number;
  end_time?: number;
  timezone_offset?: number;
  unmapped?: Record<string, unknown>;
}

/**
 * Base builder class with common OCSF event methods
 */
export abstract class BaseOCSFEventBuilder<TEvent extends BaseOCSFEvent, TBuilder> {
  protected abstract readonly event: Partial<TEvent>;

  /**
   * Set severity level
   */
  severity(severityId: SeverityId, severity?: string): TBuilder {
    this.event.severity_id = severityId;
    if (severity) {
      this.event.severity = severity;
    }
    return this as unknown as TBuilder;
  }

  /**
   * Set event status
   */
  status(statusId: StatusId, statusCode?: string, statusDetail?: string): TBuilder {
    this.event.status_id = statusId;
    if (statusCode) {
      this.event.status_code = statusCode;
    }
    if (statusDetail) {
      this.event.status_detail = statusDetail;
    }
    return this as unknown as TBuilder;
  }

  /**
   * Set event message
   */
  message(message: string): TBuilder {
    this.event.message = message;
    return this as unknown as TBuilder;
  }

  /**
   * Add metadata
   */
  withMetadata(metadata: Partial<Metadata>): TBuilder {
    this.event.metadata = {
      ...this.event.metadata!,
      ...metadata,
    };
    return this as unknown as TBuilder;
  }

  /**
   * Set duration
   */
  duration(ms: number): TBuilder {
    this.event.duration = ms;
    return this as unknown as TBuilder;
  }

  /**
   * Set start and end times
   */
  timeRange(startTime: number, endTime: number): TBuilder {
    this.event.start_time = startTime;
    this.event.end_time = endTime;
    this.event.duration = endTime - startTime;
    return this as unknown as TBuilder;
  }

  /**
   * Set timezone offset
   */
  timezoneOffset(offset: number): TBuilder {
    this.event.timezone_offset = offset;
    return this as unknown as TBuilder;
  }

  /**
   * Add unmapped custom attributes
   */
  unmapped(data: Record<string, unknown>): TBuilder {
    this.event.unmapped = {
      ...this.event.unmapped,
      ...data,
    };
    return this as unknown as TBuilder;
  }

  /**
   * Build the final event (implemented by subclasses)
   */
  abstract build(): TEvent;
}
