import type { CommandLogEntry } from "./types.js";

export class CommandLogRepository {
  private entries: CommandLogEntry[] = [];

  append(entry: CommandLogEntry): void {
    this.entries.unshift(entry);
  }

  list(limit = 100): CommandLogEntry[] {
    return this.entries.slice(0, limit);
  }

  reset(): void {
    this.entries = [];
  }
}
