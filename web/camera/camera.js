// The camera. Deliberately the least clever thing in the system.
//
// It answers sync probes with a raw reading of its own clock and never works out
// an offset; the hub does that, where it can be debugged and tested (INV-2).
// It will hold bytes and note when they arrived, and it will not understand a
// single thing about video formats (INV-3).
const nameEl = document.getElementById('name');
const pipEl = document.getElementById('pip');
const stateTextEl = document.getElementById('stateText');
const logEl = document.getElementById('log');

const token = new URLSearchParams(location.search).get('t');

function log(message) {
  const line = `${new Date().toLocaleTimeString()}  ${message}`;
  logEl.textContent = `${line}\n${logEl.textContent}`.split('\n').slice(0, 40).join('\n');
}

function setState(text, live) {
  stateTextEl.textContent = text;
  pipEl.classList.toggle('live', Boolean(live));
}

if (!token) {
  setState('no join code', false);
  nameEl.textContent = 'not enrolled';
  log('This link has no join code. Add a camera on the operator screen and scan its QR.');
}

function connect() {
  const socket = new WebSocket(`wss://${location.host}/camera`);

  socket.addEventListener('open', () => {
    setState('joining', false);
    socket.send(JSON.stringify({ type: 'hello', token }));
  });

  socket.addEventListener('close', () => {
    setState('reconnecting', false);
    setTimeout(connect, 1500);
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'welcome') {
      nameEl.textContent = message.name;
      setState('joined', true);
      log(`joined as "${message.name}"`);
      return;
    }

    if (message.type === 'rejected') {
      setState(message.reason, false);
      log(`refused: ${message.reason}`);
      return;
    }

    if (message.type === 'ping') {
      // One raw reading of our own monotonic clock. No arithmetic here.
      socket.send(JSON.stringify({ type: 'pong', sentAt: message.sentAt, deviceAt: performance.now() }));
      return;
    }

    if (message.type === 'boutPhase') {
      log(`bout is ${message.phase}`);
    }
  });
}

if (token) connect();
