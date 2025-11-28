import { vi } from 'vitest';

import { MemoryEventStore, EventStoreFactory } from '../src/index.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

describe('MemoryEventStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const createMessage = (id: string): JSONRPCMessage => ({
    jsonrpc: '2.0',
    id,
    method: 'test',
    params: { value: id }
  });

  it('stores events and replays them after a given id', async () => {
    const store = new MemoryEventStore();
    const internal = store as unknown as {
      events: Map<string, unknown>;
      streamEvents: Map<string, string[]>;
    };

    const firstId = await store.storeEvent('stream-1', createMessage('1'));
    const secondId = await store.storeEvent('stream-1', createMessage('2'));
    const thirdId = await store.storeEvent('stream-1', createMessage('3'));

    expect(internal.events.size).toBe(3);
    expect(internal.streamEvents.get('stream-1')).toEqual([firstId, secondId, thirdId]);

    const send = vi.fn().mockResolvedValue(undefined);
    const streamId = await store.replayEventsAfter(firstId, { send });

    expect(streamId).toBe('stream-1');
    expect(send).toHaveBeenNthCalledWith(1, secondId, expect.objectContaining({ id: '2' }));
    expect(send).toHaveBeenNthCalledWith(2, thirdId, expect.objectContaining({ id: '3' }));

    store.destroy();
  });

  it('throws when replaying from unknown event', async () => {
    const store = new MemoryEventStore();
    await expect(store.replayEventsAfter('missing', { send: vi.fn() })).rejects.toThrow('Event not found: missing');
    store.destroy();
  });

  it('enforces max events per stream', async () => {
    const store = new MemoryEventStore();
    const internal = store as unknown as {
      events: Map<string, unknown>;
      streamEvents: Map<string, string[]>;
    };

    const total = 1005;
    const ids: string[] = [];
    for (let i = 0; i < total; i++) {
       
      ids.push(await store.storeEvent('stream-x', createMessage(String(i))));
    }

    expect(internal.streamEvents.get('stream-x')?.length).toBeLessThanOrEqual(1000);
    expect(internal.events.size).toBe(internal.streamEvents.get('stream-x')?.length);

    store.destroy();
  });

  it('cleans up expired events', async () => {
    const store = new MemoryEventStore();
    const internal = store as unknown as {
      events: Map<string, { timestamp: number }>;
      streamEvents: Map<string, string[]>;
      cleanup(): void;
    };

    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    const eventId = await store.storeEvent('stream-1', createMessage('keep'));

    vi.setSystemTime(new Date('2024-01-03T00:00:00Z')); // >24h later
    internal.cleanup();

    expect(internal.events.has(eventId)).toBe(false);
    expect(internal.streamEvents.get('stream-1')).toBeUndefined();

    store.destroy();
  });

  it('reports aggregate statistics', async () => {
    const store = new MemoryEventStore();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    await store.storeEvent('stream-1', createMessage('1'));

    const stats = store.getStats();
    expect(stats.totalEvents).toBe(1);
    expect(stats.totalStreams).toBe(1);
    expect(stats.oldestEventAge).toBe(0);

    store.destroy();
  });

  it('destroy clears state and cancels interval', () => {
    const store = new MemoryEventStore();
    const internal = store as unknown as { cleanupInterval?: NodeJS.Timeout; events: Map<string, unknown> };

    store.destroy();
    expect(internal.cleanupInterval).toBeUndefined();
    expect(internal.events.size).toBe(0);
  });
});

describe('EventStoreFactory', () => {
  it('creates memory store by default', () => {
    const store = EventStoreFactory.createEventStore();
    expect(store).toBeInstanceOf(MemoryEventStore);
    (store as MemoryEventStore).destroy();
  });

  it('throws for unsupported type', () => {
    expect(() => EventStoreFactory.createEventStore('unsupported' as never)).toThrow('Unsupported event store type');
  });
});
