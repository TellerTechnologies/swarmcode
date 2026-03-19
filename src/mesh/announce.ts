import * as zmq from 'zeromq';
import { networkInterfaces } from 'node:os';
import type { PeerInfo } from '../types.js';

export const DEFAULT_ANNOUNCE_PORT = 9377;

export interface AnnounceResponse {
  peer_id: string;
  dev_name: string;
  pub_port: number;
  rep_port: number;
}

/**
 * Listens on a well-known port and responds with this peer's info.
 * Used as a fallback when mDNS discovery fails.
 */
export class AnnounceServer {
  private rep: zmq.Reply | null = null;
  private running = false;
  private peerInfo: AnnounceResponse;

  constructor(info: AnnounceResponse) {
    this.peerInfo = info;
  }

  async start(port: number = DEFAULT_ANNOUNCE_PORT): Promise<number> {
    this.rep = new zmq.Reply();
    await this.rep.bind(`tcp://0.0.0.0:${port}`);
    this.running = true;

    const addr = this.rep.lastEndpoint as string;
    const actualPort = Number(addr.split(':').pop());

    void this.receiveLoop();
    return actualPort;
  }

  private async receiveLoop(): Promise<void> {
    if (!this.rep) return;
    try {
      for await (const [msg] of this.rep) {
        if (!this.running) break;
        const request = msg.toString();
        if (request === 'announce') {
          await this.rep.send(JSON.stringify(this.peerInfo));
        } else {
          await this.rep.send(JSON.stringify({ error: 'unknown request' }));
        }
      }
    } catch {
      // Socket closed
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

/**
 * Polls a list of peer IPs on the announce port to discover their info.
 * Returns discovered peers. Unreachable peers are silently skipped.
 */
export async function discoverPeer(
  address: string,
  port: number = DEFAULT_ANNOUNCE_PORT,
  timeoutMs: number = 3000,
): Promise<PeerInfo | null> {
  const req = new zmq.Request();
  req.sendTimeout = timeoutMs;
  req.receiveTimeout = timeoutMs;

  try {
    req.connect(`tcp://${address}:${port}`);
    await req.send('announce');

    const [response] = await req.receive();
    const data = JSON.parse(response.toString()) as AnnounceResponse;

    if (data.error) return null;

    return {
      peer_id: data.peer_id,
      dev_name: data.dev_name,
      address,
      pub_port: data.pub_port,
      rep_port: data.rep_port,
    };
  } catch {
    return null; // Peer unreachable
  } finally {
    req.close();
  }
}

/**
 * Get the first non-loopback IPv4 address from this machine.
 */
export function getLocalIp(): string | null {
  const ifaces = networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return null;
}

/**
 * Scan the local /24 subnet for swarmcode peers on the announce port.
 * Probes all 254 IPs in parallel with a short timeout.
 * Skips the local IP to avoid self-discovery.
 */
export async function scanSubnet(
  localIp: string,
  port: number = DEFAULT_ANNOUNCE_PORT,
  timeoutMs: number = 2000,
): Promise<PeerInfo[]> {
  const parts = localIp.split('.');
  if (parts.length !== 4) return [];
  const subnet = parts.slice(0, 3).join('.');

  const probes: Promise<PeerInfo | null>[] = [];
  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}.${i}`;
    if (ip === localIp) continue;
    probes.push(discoverPeer(ip, port, timeoutMs));
  }

  const results = await Promise.all(probes);
  return results.filter((p): p is PeerInfo => p !== null);
}
