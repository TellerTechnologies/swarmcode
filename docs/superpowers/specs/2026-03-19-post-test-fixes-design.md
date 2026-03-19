# Post-Test Fixes Design

Fixes for 6 issues found during the two-machine swarmcode evaluation.

## 1. Initial State Sync

**Problem:** When a peer connects, they don't see files that existed before the connection. Only new changes are broadcast.

**Fix:** When `peer-discovered` fires, scan all files the watcher knows about and broadcast a `file_modified` update for each. This reuses the existing `handleFileChange` path -- we just need access to the watcher's known file set.

**Changes:**
- `watcher.ts`: expose `getKnownFiles(): string[]`
- `agent.ts`: in `peer-discovered` handler, call a new `broadcastCurrentState()` method that iterates known files and publishes updates for each

## 2. Active Heartbeat

**Problem:** Peers go "offline" if they haven't edited files in 15s, because heartbeat only updates on file broadcasts.

**Fix:** Add a periodic heartbeat broadcast every 5s. Use a minimal `SwarmUpdate` with `event_type: 'heartbeat'` and no file data. On the receiving end, update `last_seen` without applying file state.

**Changes:**
- `types.ts`: add `'heartbeat'` to `EventType` union
- `agent.ts`: add heartbeat broadcast in the existing `heartbeatTimer` interval (repurpose it to both send and check)
- `agent.ts`: in the `update` handler, skip `applyUpdate` for heartbeat events but still call `heartbeat()`

## 3. PLAN.md Parser

**Problem:** Parser expects `- **Feature** - Owner` but our PLAN.md uses a different structure with `## Assignments` section and `- **name** — role` followed by indented file paths.

**Fix:** Rewrite the parser to handle both formats:
- Original: `- **Auth system** - Jared`
- New: `- **laptop** — Backend` (name first, em-dash)
- Indented file paths: `  - src/lib/types.ts — description`

The parser should extract: who owns what files/directories.

**Changes:**
- `plan/parser.ts`: update regex and parsing logic to handle both formats

## 4. Init Peers + mDNS Check

**Problem:** Users have to know about `--peer` flags. No guidance during setup.

**Fix:** Enhance `swarmcode init` to:
1. Run an mDNS diagnostic (try to bind port 5353 briefly, report result)
2. Prompt for optional peer IPs (comma-separated)
3. Write `peers` array to config.yaml

Since we're a CLI tool (not interactive in all contexts), also support `--peers` flag: `swarmcode init --name Jared --peers 192.168.1.15,192.168.1.20`

**Changes:**
- `cli.ts`: add `--peers` option to init, add mDNS check
- `config.ts`: add `peers: string[]` to config schema and defaults

## 5. Config-Based Peers

**Problem:** `--peer` flags on every `start` is tedious.

**Fix:** Read `peers` from config.yaml and merge with any `--peer` CLI flags. The agent already accepts `manualPeers` -- just pass config peers + CLI peers combined.

**Changes:**
- `types.ts`: add `peers` to `SwarmConfig`
- `config.ts`: parse `peers` from yaml, default to `[]`
- `cli.ts`: merge config.peers with --peer flags before passing to agent

## 6. Subnet Scan Fallback

**Problem:** If mDNS fails and no peers are configured, there's no discovery.

**Fix:** After startup, if no peers are discovered within 5s (from mDNS or config), scan the local /24 subnet on the announce port (9377). Scan all 254 IPs in parallel with a 2s timeout per probe. This runs once on startup, then again every 60s if peers is still 0.

**Changes:**
- `mesh/announce.ts`: add `scanSubnet(localIp: string, port?: number): Promise<PeerInfo[]>`
- `agent.ts`: add subnet scan fallback after initial discovery window
- Need a way to get local IP -- use `os.networkInterfaces()`
