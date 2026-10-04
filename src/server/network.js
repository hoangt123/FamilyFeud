// Network helpers: find the LAN address phones should connect to, and print a
// scannable QR code in the terminal using the dependency-free qrcode-generator.
import { networkInterfaces } from 'node:os';
import qrcode from 'qrcode-generator';

export function lanAddress() {
  const nets = networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        const priv =
          net.address.startsWith('192.168.') ||
          net.address.startsWith('10.') ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(net.address);
        candidates.push({ address: net.address, priv });
      }
    }
  }
  candidates.sort((a, b) => Number(b.priv) - Number(a.priv));
  return candidates[0]?.address || '127.0.0.1';
}

// Render a QR for `text` as compact half-block characters for the terminal.
export function qrToTerminal(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const dark = (r, c) => r >= 0 && r < n && c >= 0 && c < n && qr.isDark(r, c);
  const QUIET = 2;
  let out = '\n';
  for (let r = -QUIET; r < n + QUIET; r += 2) {
    let line = '  ';
    for (let c = -QUIET; c < n + QUIET; c++) {
      const top = dark(r, c);
      const bot = dark(r + 1, c);
      if (top && bot) line += '█';
      else if (top) line += '▀';
      else if (bot) line += '▄';
      else line += ' ';
    }
    out += line + '\n';
  }
  return out;
}
