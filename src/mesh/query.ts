import * as zmq from 'zeromq';
import type { QueryRequest, QueryResponse } from '../types.js';

type HandlerFn = (req: QueryRequest) => Promise<QueryResponse>;

export class QueryServer {
  private readonly handler: HandlerFn;
  private rep: zmq.Reply | null = null;
  private running = false;

  constructor(handler: HandlerFn) {
    this.handler = handler;
  }

  async start(port: number): Promise<number> {
    this.rep = new zmq.Reply();
    await this.rep.bind(`tcp://0.0.0.0:${port}`);

    // Extract the actual port from the bound address (important when port=0)
    const addr = this.rep.lastEndpoint as string;
    const actualPort = Number(addr.split(':').pop());

    this.running = true;
    void this.receiveLoop();

    return actualPort;
  }

  private async receiveLoop(): Promise<void> {
    if (!this.rep) return;

    for await (const [msg] of this.rep) {
      if (!this.running) break;

      let response: QueryResponse;
      try {
        const request = JSON.parse(msg.toString()) as QueryRequest;
        response = await this.handler(request);
      } catch (err) {
        // We need at least the request fields to echo back; parse again safely
        let type: QueryResponse['type'] = 'exports';
        let file_path = '';
        try {
          const parsed = JSON.parse(msg.toString()) as Partial<QueryRequest>;
          type = parsed.type ?? type;
          file_path = parsed.file_path ?? file_path;
        } catch {
          // ignore secondary parse failure
        }
        response = {
          type,
          file_path,
          data: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      await this.rep.send(JSON.stringify(response));
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.rep) {
      this.rep.close();
      this.rep = null;
    }
  }
}

export class QueryClient {
  // Cache one REQ socket per endpoint string "address:port"
  private readonly sockets: Map<string, zmq.Request> = new Map();

  private getSocket(address: string, port: number): zmq.Request {
    const key = `${address}:${port}`;
    let sock = this.sockets.get(key);
    if (!sock) {
      sock = new zmq.Request();
      sock.connect(`tcp://${address}:${port}`);
      this.sockets.set(key, sock);
    }
    return sock;
  }

  async query(address: string, port: number, request: QueryRequest, timeoutMs = 5000): Promise<QueryResponse> {
    const sock = this.getSocket(address, port);
    await sock.send(JSON.stringify(request));

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Query timeout')), timeoutMs)
    );
    const [response] = await Promise.race([sock.receive(), timeout]);
    return JSON.parse(response.toString()) as QueryResponse;
  }

  async close(): Promise<void> {
    for (const sock of this.sockets.values()) {
      sock.close();
    }
    this.sockets.clear();
  }
}
