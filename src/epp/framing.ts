export function encodeFrame(xml: string): Buffer {
  const payload = Buffer.from(xml, "utf8");
  const frame = Buffer.allocUnsafe(payload.length + 4);
  frame.writeUInt32BE(frame.length, 0);
  payload.copy(frame, 4);
  return frame;
}

export class EppFrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): string[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: string[] = [];

    while (this.buffer.length >= 4) {
      const frameLength = this.buffer.readUInt32BE(0);

      if (frameLength < 5) {
        throw new Error(`Invalid EPP frame length: ${frameLength}`);
      }

      if (this.buffer.length < frameLength) {
        break;
      }

      const payload = this.buffer.subarray(4, frameLength);
      messages.push(payload.toString("utf8"));
      this.buffer = this.buffer.subarray(frameLength);
    }

    return messages;
  }
}
