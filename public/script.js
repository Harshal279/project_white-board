let canvas = document.getElementById('canvas');
canvas.width = 0.98 * window.innerWidth;
canvas.height = window.innerHeight;

let ctx = canvas.getContext("2d");
let x, y, mouseDown = false;
let currentTool = "pen";
let startX, startY;

let color = document.getElementById("colorPicker").value;
let penSize = document.getElementById("penSize").value;

let signalingSocket = io.connect();
let peerConnections = {};
let dataChannels = {};

document.getElementById("colorPicker").onchange = (e) => {
    color = e.target.value;
};

document.getElementById("penSize").oninput = (e) => {
    penSize = e.target.value;
};

function setTool(tool) {
    currentTool = tool;
}

function draw(x, y, type = 'pen', remote = false, params = {}) {
    ctx.strokeStyle = color;
    ctx.lineWidth = penSize;
    ctx.fillStyle = color;

    if (type === 'pen') {
        ctx.lineTo(x, y);
        ctx.stroke();
    } else {
        let { startX, startY } = params;
        ctx.beginPath();
        switch (type) {
            case 'line':
                ctx.moveTo(startX, startY);
                ctx.lineTo(x, y);
                ctx.stroke();
                break;
            case 'rect':
                ctx.strokeRect(startX, startY, x - startX, y - startY);
                break;
            case 'circle':
                let radius = Math.hypot(x - startX, y - startY);
                ctx.arc(startX, startY, radius, 0, Math.PI * 2);
                ctx.stroke();
                break;
        }
    }

    if (!remote) {
        for (let id in dataChannels) {
            if (dataChannels[id].readyState === 'open') {
                dataChannels[id].send(JSON.stringify({ x, y, type, startX, startY, color, penSize }));
            }
        }
        signalingSocket.emit('draw', { x, y, type, startX, startY, color, penSize });
    }
}

canvas.onmousedown = (e) => {
    x = e.clientX;
    y = e.clientY;
    startX = x;
    startY = y;
    mouseDown = true;

    if (currentTool === 'pen') {
        ctx.beginPath();
        ctx.moveTo(x, y);
    }

    signalingSocket.emit('down', { x, y });
};

canvas.onmouseup = (e) => {
    mouseDown = false;
    if (currentTool !== 'pen') {
        draw(e.clientX, e.clientY, currentTool, false, { startX, startY });
    }
};

canvas.onmousemove = (e) => {
    if (mouseDown && currentTool === 'pen') {
        draw(e.clientX, e.clientY);
    }
};

signalingSocket.on("ondraw", (data) => {
    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.penSize;
    ctx.fillStyle = data.color;

    if (data.type === 'pen') {
        ctx.lineTo(data.x, data.y);
        ctx.stroke();
    } else {
        draw(data.x, data.y, data.type, true, {
            startX: data.startX,
            startY: data.startY
        });
    }
});

signalingSocket.on("ondown", (data) => {
    ctx.beginPath();
    ctx.moveTo(data.x, data.y);
});

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

function setupDataChannel(dataChannel, id) {
    dataChannel.onmessage = (event) => {
        const data = JSON.parse(event.data);
        ctx.strokeStyle = data.color;
        ctx.lineWidth = data.penSize;
        ctx.fillStyle = data.color;

        draw(data.x, data.y, data.type, true, {
            startX: data.startX,
            startY: data.startY
        });
    };

    dataChannel.onerror = (error) => {
        console.error(`Data Channel Error: ${error}`);
    };

    dataChannel.onopen = () => {
        console.log("Data channel opened");
    };

    dataChannel.onclose = () => {
        console.log("Data channel closed");
    };
}

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
