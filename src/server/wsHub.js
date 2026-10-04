// WebSocket hub: tracks every connected screen, routes host commands to the
// GameEngine, and broadcasts role-aware state snapshots after each change.
import { WebSocketServer } from 'ws';
import { C2S, ROLE, S2C } from '../shared/protocol.js';

const ROLES = new Set(Object.values(ROLE));

export class Hub {
  constructor(engine) {
    this.engine = engine;
    this.conns = new Set(); // { ws, role }
    // Engine calls this whenever state changes.
    engine.notify = () => this.broadcast();
  }

  attach(httpServer) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    this.wss.on('connection', (ws) => this.onConnection(ws));
    // Drop dead sockets that stopped responding to pings.
    this.heartbeat = setInterval(() => {
      for (const c of this.conns) {
        if (c.ws.isAlive === false) {
          c.ws.terminate();
          continue;
        }
        c.ws.isAlive = false;
        try {
          c.ws.ping();
        } catch {
          /* ignore */
        }
      }
    }, 15000);
  }

  onConnection(ws) {
    const conn = { ws, role: null };
    this.conns.add(conn);
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.onMessage(conn, msg);
    });
    ws.on('close', () => this.conns.delete(conn));
    ws.on('error', () => {});
  }

  onMessage(conn, msg) {
    if (msg.type === C2S.HELLO) {
      conn.role = ROLES.has(msg.role) ? msg.role : ROLE.DISPLAY;
      this.send(conn, { type: S2C.WELCOME, role: conn.role });
      this.sendState(conn);
      return;
    }
    // All gameplay commands go through the engine, which checks the role.
    if (conn.role) this.engine.handle(conn.role, msg);
  }

  sendState(conn) {
    this.send(conn, { type: S2C.STATE, state: this.engine.serialize(conn.role) });
  }

  broadcast() {
    for (const conn of this.conns) if (conn.role) this.sendState(conn);
  }

  send(conn, obj) {
    if (conn.ws.readyState === conn.ws.OPEN) {
      try {
        conn.ws.send(JSON.stringify(obj));
      } catch {
        /* ignore */
      }
    }
  }
}
