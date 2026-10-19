export function retryDelay(attempt, random = Math.random) {
  return Math.round(Math.min(5000 * 2 ** attempt, 30000) * (0.85 + random() * 0.3));
}
export function connectRoom(room, onEvent, onStatus) {
  let socket, timer, ping, stable, stopped = false, attempts = 0;
  const clear = () => { clearTimeout(timer); clearInterval(ping); clearTimeout(stable); };
  function connect() {
    if (stopped) return;
    onStatus('Connecting');
    const url = new URL(`{{kit.routePrefix}}/${encodeURIComponent(room)}`, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url);
    socket.onopen = () => {
      if (stopped) { socket.close(1000); return; }
      onStatus('Connected');
      stable = setTimeout(() => { attempts = 0; }, 10000);
      ping = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send('ping'); }, 20000);
    };
    socket.onmessage = ({ data }) => { if (!stopped && data !== 'pong') { try { onEvent(JSON.parse(data)); } catch { onStatus('Invalid server message'); } } };
    socket.onclose = ({ code }) => {
      clear();
      if (stopped) return;
      if (code === 1000 || code === 1008 || attempts >= 10) { onStatus(code === 1008 ? 'Sign in again or wait before reconnecting' : 'Disconnected'); return; }
      onStatus('Reconnecting');
      timer = setTimeout(connect, retryDelay(attempts++));
    };
    socket.onerror = () => { onStatus('Connection failed'); };
  }
  connect();
  return {
    send(text) { if (socket?.readyState !== WebSocket.OPEN) return false; socket.send(JSON.stringify({ text })); return true; },
    close() { stopped = true; clear(); socket?.close(1000, 'Leaving room'); },
  };
}
