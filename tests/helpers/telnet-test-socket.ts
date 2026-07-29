export class CapturedTelnetTransport {
  private readonly chunks: Buffer[] = [];

  write(chunk: Buffer) {
    this.chunks.push(Buffer.from(chunk));
  }

  get writeCount() {
    return this.chunks.length;
  }

  getChunks() {
    return this.chunks.map((chunk) => Buffer.from(chunk));
  }

  getBytes() {
    return Array.from(Buffer.concat(this.chunks));
  }

  clear() {
    this.chunks.length = 0;
  }
}

export function createCapturedTelnetTransport() {
  return new CapturedTelnetTransport();
}
