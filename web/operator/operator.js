// The operator's table. Displays what the hub tells it and asks the hub to do
// things; it works nothing out for itself.
const camerasEl = document.getElementById('cameras');
const noCamerasEl = document.getElementById('noCameras');
const phaseEl = document.getElementById('phase');
const qrDialog = document.getElementById('qrDialog');

function renderCameras(cameras) {
  noCamerasEl.hidden = cameras.length > 0;
  camerasEl.innerHTML = '';

  for (const camera of cameras) {
    const card = document.createElement('div');
    card.className = camera.live ? 'camera live' : 'camera';

    const name = document.createElement('div');
    name.className = 'name';
    const pip = document.createElement('span');
    pip.className = 'pip';
    name.append(pip, document.createTextNode(camera.name));

    const detail = document.createElement('div');
    detail.className = 'detail';
    if (!camera.live && !camera.everJoined) {
      detail.textContent = 'waiting for its QR to be scanned';
    } else if (!camera.live) {
      detail.textContent = 'not responding';
    } else if (camera.syncUncertaintyMs === null) {
      detail.textContent = 'live — measuring clock';
    } else {
      detail.textContent = `live — clock ±${Math.round(camera.syncUncertaintyMs)}ms`;
    }

    card.append(name, detail);
    camerasEl.append(card);
  }
}

function connect() {
  const socket = new WebSocket(`wss://${location.host}/operator`);
  socket.addEventListener('close', () => setTimeout(connect, 1500));
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'cameras') renderCameras(message.cameras);
    if (message.type === 'boutPhase') phaseEl.textContent = message.phase;
  });
}

document.getElementById('addBtn').addEventListener('click', async () => {
  const input = document.getElementById('cameraName');
  const response = await fetch('/api/cameras', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: input.value }),
  });
  const camera = await response.json();
  input.value = '';

  document.getElementById('qrName').textContent = camera.name;
  document.getElementById('qr').innerHTML = camera.qr;
  document.getElementById('joinUrl').textContent = camera.joinUrl;
  qrDialog.showModal();
});

document.getElementById('qrClose').addEventListener('click', () => qrDialog.close());

async function setPhase(phase) {
  await fetch('/api/bout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phase }),
  });
}
document.getElementById('startBtn').addEventListener('click', () => setPhase('recording'));
document.getElementById('stopBtn').addEventListener('click', () => setPhase('idle'));

connect();
