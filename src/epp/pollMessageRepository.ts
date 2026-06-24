import { randomUUID } from "node:crypto";

export interface PollMessage {
  id: string;
  registrarId: string;
  text: string;
  enqueuedAt: string;
  resData?: Record<string, unknown>;
}

export interface EnqueuePollMessageInput {
  registrarId: string;
  text: string;
  resData?: Record<string, unknown>;
}

/**
 * In-memory per-registrar EPP poll message queue (RFC 5730 service message queue).
 */
export class PollMessageRepository {
  private readonly queues = new Map<string, PollMessage[]>();

  enqueue(input: EnqueuePollMessageInput): PollMessage {
    const message: PollMessage = {
      id: randomUUID(),
      registrarId: input.registrarId,
      text: input.text,
      enqueuedAt: new Date().toISOString(),
      resData: input.resData
    };

    const queue = this.queues.get(input.registrarId) ?? [];
    queue.push(message);
    this.queues.set(input.registrarId, queue);
    return message;
  }

  peek(registrarId: string): PollMessage | undefined {
    return this.queues.get(registrarId)?.[0];
  }

  count(registrarId: string): number {
    return this.queues.get(registrarId)?.length ?? 0;
  }

  ack(registrarId: string, messageId: string): { acked: boolean; remaining: number } {
    const queue = this.queues.get(registrarId) ?? [];
    const index = queue.findIndex((message) => message.id === messageId);

    if (index === -1) {
      return { acked: false, remaining: queue.length };
    }

    queue.splice(index, 1);
    this.queues.set(registrarId, queue);
    return { acked: true, remaining: queue.length };
  }

  reset(): void {
    this.queues.clear();
  }
}
