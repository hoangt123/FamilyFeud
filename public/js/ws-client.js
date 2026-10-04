// Reconnecting WebSocket client shared by every screen.
// Auto-reconnects with backoff, re-sends HELLO (with saved token) on connect,
// and exposes a small callback API.
import { C2S, S2C } from '/shared/protocol.js';

export class GameClient {
  constructor({ role, tokenKey }) {
    this.role = role;
    this.tokenKey = tokenKey;
    this.token = tokenKey ? localStorage.getItem(tokenKey) : null;
    this.handlers = { state: [], welcome: [], error: [], status: [] };
    this.backoff = 500;
    this.ws = null;
    this._connect();
  }

  on(event, fn) {
    this.handlers[event]?.push(fn);
    return this;
  }

  _emit(event, payload) {
    for (const fn of this.handlers[event] || []) fn(payload);
  }

  _connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.backoff = 500;
      this._emit('status', 'connected');
      this.send(C2S.HELLO, { role: this.role, token: this.token || undefined });
    });

    ws.addEventListener('message', (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === S2C.WELCOME) {
        if (msg.token && this.tokenKey) {
          this.token = msg.token;
          localStorage.setItem(this.tokenKey, msg.token);
        }
        this._emit('welcome', msg);
      } else if (msg.type === S2C.STATE) {
        this._emit('state', msg.state);
      } else if (msg.type === S2C.ERROR) {
        this._emit('error', msg.message);
      }
    });

    ws.addEventListener('close', () => {
      this._emit('status', 'disconnected');
      setTimeout(() => this._connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 1.6, 5000);
    });

    ws.addEventListener('error', () => ws.close());
  }

  send(type, data = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }

  clearToken() {
    this.token = null;
    if (this.tokenKey) localStorage.removeItem(this.tokenKey);
  }
}
