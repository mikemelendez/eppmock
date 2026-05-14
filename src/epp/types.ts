export interface EppSession {
  id: string;
  authenticated: boolean;
  clid?: string;
  connectedAt: Date;
  lastCommandAt: Date;
}

export interface CommandContext {
  session: EppSession;
  rawXml: string;
  transactionId?: string;
}

export interface CommandHandler {
  handle(document: Record<string, unknown>, context: CommandContext): Promise<string>;
}

export interface CommandLogEntry {
  id: string;
  sessionId: string;
  clid?: string;
  commandName: string;
  requestXml: string;
  responseXml: string;
  createdAt: string;
}
