/**
 * Event store implementation for Streamable HTTP transport resumability
 */

import { EventStore, EventId, StreamId } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../logger.js';

/**
 * Stored event with metadata
 */
interface StoredEvent {
  eventId: EventId;
  streamId: StreamId;
  message: JSONRPCMessage;
  timestamp: number;
}

/**
 * In-memory event store implementation with automatic cleanup
 *
 * For production use, consider implementing a persistent store (Redis, Database, etc.)
 */
export class MemoryEventStore implements EventStore {
  private events: Map<EventId, StoredEvent> = new Map();
  private streamEvents: Map<StreamId, EventId[]> = new Map();
  private eventCounter = 0;
  private readonly MAX_EVENTS_PER_STREAM = 1000;
  private readonly EVENT_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private cleanupInterval?: NodeJS.Timeout;

  constructor() {
    // Start cleanup task to remove old events
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 60 * 1000); // Every hour
  }

  /**
   * Store an event for later retrieval
   */
  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    const eventId = this.generateEventId();
    const timestamp = Date.now();

    const storedEvent: StoredEvent = {
      eventId,
      streamId,
      message,
      timestamp,
    };

    // Store the event
    this.events.set(eventId, storedEvent);

    // Track event for this stream
    if (!this.streamEvents.has(streamId)) {
      this.streamEvents.set(streamId, []);
    }

    const streamEventList = this.streamEvents.get(streamId) ?? [];
    streamEventList.push(eventId);

    // Limit events per stream to prevent memory bloat
    if (streamEventList.length > this.MAX_EVENTS_PER_STREAM) {
      const oldEventId = streamEventList.shift();
      if (oldEventId !== undefined) {
        this.events.delete(oldEventId);
      }
    }

    return eventId;
  }

  /**
   * Replay events that occurred after the specified event ID
   */
  async replayEventsAfter(
    lastEventId: EventId,
    { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> }
  ): Promise<StreamId> {
    // Find the event with the given ID
    const lastEvent = this.events.get(lastEventId);
    if (!lastEvent) {
      throw new Error(`Event not found: ${lastEventId}`);
    }

    const streamId = lastEvent.streamId;
    const streamEventList = this.streamEvents.get(streamId);
    if (!streamEventList) {
      return streamId;
    }

    // Find the position of the last event ID
    const lastEventIndex = streamEventList.indexOf(lastEventId);
    if (lastEventIndex === -1) {
      throw new Error(`Event ${lastEventId} not found in stream ${streamId}`);
    }

    // Send all events after the last event ID
    const eventsToReplay = streamEventList.slice(lastEventIndex + 1);

    for (const eventId of eventsToReplay) {
      const event = this.events.get(eventId);
      if (event) {
        await send(eventId, event.message);
      }
    }

    return streamId;
  }

  /**
   * Generate a unique event ID
   */
  private generateEventId(): EventId {
    return `event_${Date.now()}_${++this.eventCounter}`;
  }

  /**
   * Clean up old events based on TTL
   */
  private cleanup(): void {
    const now = Date.now();
    const expiredEvents: EventId[] = [];

    // Find expired events
    for (const [eventId, event] of this.events) {
      if (now - event.timestamp > this.EVENT_TTL) {
        expiredEvents.push(eventId);
      }
    }

    // Remove expired events
    for (const eventId of expiredEvents) {
      const event = this.events.get(eventId);
      if (event) {
        this.events.delete(eventId);

        // Remove from stream tracking
        const streamEventList = this.streamEvents.get(event.streamId);
        if (streamEventList) {
          const index = streamEventList.indexOf(eventId);
          if (index !== -1) {
            streamEventList.splice(index, 1);
          }

          // Clean up empty stream lists
          if (streamEventList.length === 0) {
            this.streamEvents.delete(event.streamId);
          }
        }
      }
    }

    if (expiredEvents.length > 0) {
      logger.debug("Cleaned up expired events", { count: expiredEvents.length });
    }
  }

  /**
   * Get statistics about the event store
   */
  getStats(): { totalEvents: number; totalStreams: number; oldestEventAge: number } {
    const now = Date.now();
    let oldestTimestamp = now;

    for (const event of this.events.values()) {
      if (event.timestamp < oldestTimestamp) {
        oldestTimestamp = event.timestamp;
      }
    }

    return {
      totalEvents: this.events.size,
      totalStreams: this.streamEvents.size,
      oldestEventAge: now - oldestTimestamp,
    };
  }

  /**
   * Clear all events (for testing)
   */
  clear(): void {
    this.events.clear();
    this.streamEvents.clear();
    this.eventCounter = 0;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.clear();
  }
}

/**
 * Factory for creating event store instances
 */
export class EventStoreFactory {
  /**
   * Create an event store based on configuration
   * For now, only returns in-memory store, but can be extended for persistent stores
   */
  static createEventStore(type: 'memory' = 'memory'): EventStore {
    switch (type) {
      case 'memory':
        return new MemoryEventStore();
      default:
        throw new Error(`Unsupported event store type: ${type}`);
    }
  }
}