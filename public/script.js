let canvas = document.getElementById('canvas');
canvas.width = 0.98 * window.innerWidth;
canvas.height = window.innerHeight;

let ctx = canvas.getContext("2d");
let x, y, mouseDown = false;
let signalingSocket = io.connect();

// Store multiple peer connections
let peerConnections = {};
let dataChannels = {};

function draw(x, y) {
    ctx.lineTo(x, y);
    ctx.stroke();
}

// Handle mouse events
canvas.onmousedown = (e) => {
    x = e.clientX;
    y = e.clientY;
    ctx.beginPath();
    ctx.moveTo(x, y);
    mouseDown = true;
    signalingSocket.emit('down', { x, y });
};

canvas.onmouseup = () => {
    mouseDown = false;
};

canvas.onmousemove = (e) => {
    if (mouseDown) {
        x = e.clientX;
        y = e.clientY;
        draw(x, y);

        for (let id in dataChannels) {
            if (dataChannels[id].readyState === 'open') {
                dataChannels[id].send(JSON.stringify({ x, y }));
            }
        }

        signalingSocket.emit('draw', { x, y });
    }
};

// Listen for fallback drawing
signalingSocket.on("ondraw", (data) => {
    draw(data.x, data.y);
});

signalingSocket.on("ondown", (data) => {
    ctx.beginPath();
    ctx.moveTo(data.x, data.y);
});

// Create peer connection with specific socket ID
function createPeerConnection(id, isInitiator) {
    const peerConnection = new RTCPeerConnection();

    if (isInitiator) {
        const dataChannel = peerConnection.createDataChannel("drawData");
        setupDataChannel(dataChannel, id);
        dataChannels[id] = dataChannel;
    } else {
        peerConnection.ondatachannel = (event) => {
            const dataChannel = event.channel;
            setupDataChannel(dataChannel, id);
            dataChannels[id] = dataChannel;
        };
    }

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            signalingSocket.emit("signal", {
                type: "candidate",
                candidate: event.candidate,
                to: id,
            });
        }
    };

    peerConnections[id] = peerConnection;
    return peerConnection;
}

// Set up drawing for received data
function setupDataChannel(dataChannel, id) {
    dataChannel.onmessage = (event) => {
        const data = JSON.parse(event.data);
        draw(data.x, data.y);
    };
}

// Handle signaling messages
signalingSocket.on('signal', async (data) => {
    const fromId = data.from;
    if (!peerConnections[fromId]) {
        createPeerConnection(fromId, false);
    }

    const peerConnection = peerConnections[fromId];

    if (data.type === 'offer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        signalingSocket.emit('signal', {
            type: 'answer',
            answer,
            to: fromId
        });
    } else if (data.type === 'answer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.type === 'candidate') {
        if (data.candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    }
});

// When a new user connects
signalingSocket.on("user-connected", (id) => {
    const peerConnection = createPeerConnection(id, true);

    peerConnection.createOffer()
        .then(offer => peerConnection.setLocalDescription(offer))
        .then(() => {
            signalingSocket.emit("signal", {
                type: "offer",
                offer: peerConnection.localDescription,
                to: id,
            });
        });
});
