const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

// Serve frontend from "public" directory
app.use(express.static('public'));

// ————————————————— SOCKET.IO —————————————————
io.on('connection', socket => {
  console.log(`${socket.id} connected`);

  // Notify other users
  socket.broadcast.emit('user-connected', socket.id);

  // Fallback drawing events (mouse down & draw)
  socket.on('down', data => socket.broadcast.emit('ondown', data));
  socket.on('draw', data => socket.broadcast.emit('ondraw', data));

  // WebRTC signaling
  socket.on('signal', payload => {
    io.to(payload.to).emit('signal', { ...payload, from: socket.id });
  });

  socket.on('disconnect', () => {
    console.log(`${socket.id} disconnected`);
    socket.broadcast.emit('peer-disconnected', socket.id);
  });
});

// ————————————————— START SERVER —————————————————
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
