export const PROTO = 1;

export function deviceId() {
  try {
    let id = localStorage.getItem("kicker-device");
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("kicker-device", id);
    }
    return id;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function loadProfile() {
  try { return { name: "", emoji: "🙂", ...JSON.parse(localStorage.getItem("kicker-profile") || "{}") }; }
  catch { return { name: "", emoji: "🙂" }; }
}
export function saveProfile(p) {
  try { localStorage.setItem("kicker-profile", JSON.stringify(p)); } catch {}
}

const WS_URL = import.meta.env.VITE_WS_URL
  || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

export class Net {
  constructor() {
    this.ws = null;
    this.closed = false;
    this.retry = 0;
    this.status = "off";
    this.onMessage = null;
    this.onStatus = null;
    this.onOpen = null;
  }
  connect() {
    this.closed = false;
    this._open();
  }
  _open() {
    this._setStatus("connecting");
    let ws;
    try { ws = new WebSocket(WS_URL); } catch { return this._retry(); }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this._setStatus("on");
      this.send({ type: "hello", proto: PROTO, deviceId: deviceId() });
      this.onOpen && this.onOpen();
    };
    ws.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      this.onMessage && this.onMessage(m);
    };
    ws.onclose = () => { if (!this.closed) this._retry(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  _retry() {
    this._setStatus("connecting");
    const delay = Math.min(5000, 800 * Math.pow(2, this.retry++));
    setTimeout(() => { if (!this.closed) this._open(); }, delay);
  }
  _setStatus(s) {
    this.status = s;
    this.onStatus && this.onStatus(s);
  }
  send(obj) {
    try { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj)); } catch {}
  }
  close() {
    this.closed = true;
    this._setStatus("off");
    try { this.ws?.close(); } catch {}
  }
}
