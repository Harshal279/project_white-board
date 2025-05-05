/* -------------------- canvas setup -------------------- */
const canvas = document.getElementById('canvas');
const ctx     = canvas.getContext('2d');

function resize () {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  ctx.lineWidth = 2;
  ctx.lineCap   = 'round';
  ctx.strokeStyle = '#000';
}
window.addEventListener('resize', resize);
resize();

/* -------------------- sockets -------------------- */
const socket = io();                // signalling / fallback

/* -------------------- WebRTC storage -------------------- */
const peers        = {};            // socketId ➜ RTCPeerConnection
const dataChannels = {};            // socketId ➜ RTCDataChannel

function sendStroke(kind, x, y) {
  const payload = JSON.stringify({ kind, x, y });

  //  WebRTC (fast, p2p)
  Object.values(dataChannels).forEach(dc => {
    if (dc.readyState === 'open') dc.send(payload);
  });

  //  Socket.IO fallback (everyone)
  socket.emit(kind, { x, y });
}

function beginPath(x, y) {
  ctx.beginPath();
  ctx.moveTo(x, y);
}

function addLine(x, y) {
  ctx.lineTo(x, y);
  ctx.stroke();
}

/* -------------------- local mouse events -------------------- */
let drawing = false;

canvas.addEventListener('mousedown', e => {
  drawing = true;
  beginPath(e.clientX, e.clientY);
  sendStroke('down', e.clientX, e.clientY);
});

canvas.addEventListener('mouseup', () => drawing = false);

let lastEmit = 0;
canvas.addEventListener('mousemove', e => {
  if (!drawing) return;
  const now = Date.now();
  if (now - lastEmit < 16) return;   // ~60 fps throttle

  addLine(e.clientX, e.clientY);
  sendStroke('draw', e.clientX, e.clientY);
  lastEmit = now;
});

/* -------------------- receive fallback strokes -------------------- */
socket.on('ondown', data => beginPath(data.x, data.y));
socket.on('ondraw', data => addLine (data.x, data.y));

/* -------------------- WebRTC helpers -------------------- */
function makePeer(id, initiator) {
  if (peers[id]) return peers[id];
  const pc = new RTCPeerConnection();

  // Data‑channel creation / reception
  if (initiator) {
    const dc = pc.createDataChannel('draw');
    wireDataChannel(id, dc);
  } else {
    pc.ondatachannel = e => wireDataChannel(id, e.channel);
  }

  // ICE
  pc.onicecandidate = ({candidate}) => {
    if (candidate) socket.emit('signal', { to:id, type:'candidate', candidate });
  };

  peers[id] = pc;
  return pc;
}

function wireDataChannel(id, dc) {
  dataChannels[id] = dc;
  dc.onmessage = e => {
    const {kind,x,y} = JSON.parse(e.data);
    if (kind === 'down') beginPath(x, y);
    else                 addLine (x, y);
  };
  dc.onclose = () => delete dataChannels[id];
}

/* -------------------- signalling -------------------- */
socket.on('user-connected', async id => {
  const pc = makePeer(id, true);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('signal', { to:id, type:'offer', offer });
});

socket.on('signal', async data => {
  const {from:id} = data;
  const pc = makePeer(id, false);

  if (data.type === 'offer') {
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('signal', { to:id, type:'answer', answer });

  } else if (data.type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));

  } else if (data.type === 'candidate' && data.candidate) {
    try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); }
    catch (e) { console.warn('ICE error', e); }
  }
});

socket.on('peer-disconnected', id => {
  if (peers[id])  peers[id].close();
  delete peers[id];
  delete dataChannels[id];
});
