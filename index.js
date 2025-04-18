const express = require('express');
const app = express();
const httpServer = require('http').createServer(app);
const io = require('socket.io')(httpServer);

let connections = [];

io.on('connection', (socket) => {
    connections.push(socket);
    console.log(`${socket.id} has connected`);

    // Notify existing clients about the new user
    socket.broadcast.emit("user-connected", socket.id);

    socket.on("draw", (data) => {
        connections.forEach((con) => {
            if (con.id !== socket.id) {
                con.emit("ondraw", { x: data.x, y: data.y });
            }
        });
    });

    socket.on("down", (data) => {
        connections.forEach((con) => {
            if (con.id !== socket.id) {
                con.emit("ondown", { x: data.x, y: data.y });
            }
        });
    });

    // WebRTC signaling
    socket.on('signal', (data) => {
        const recipientSocket = connections.find((s) => s.id === data.to);
        if (recipientSocket) {
            recipientSocket.emit('signal', {
                ...data,
                from: socket.id,
            });
        }
    });

    socket.on('disconnect', () => {
        console.log(`${socket.id} is disconnected`);
        connections = connections.filter((con) => con.id !== socket.id);
    });
});

// Serve static files from public/
app.use(express.static('public'));

// Use dynamic port for Render compatibility
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
    console.log(`Server started on Port: ${PORT}`);
});
