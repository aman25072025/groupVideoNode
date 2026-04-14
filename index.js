const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { createWorkers, createRouter, createWebRtcTransport } = require('./mediasoup');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "https://aman25072025.github.io"
    ],
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/build')));

// Store active rooms and participants
const rooms = new Map();
const participants = new Map();

// MediaSoup workers
let workers = [];
let router;

async function initializeMediaSoup() {
  try {
    console.log('Initializing MediaSoup...');
    workers = await createWorkers();
    if (workers.length > 0) {
      router = await createRouter(workers[0]);
      console.log('MediaSoup initialized successfully');
    } else {
      console.warn('No MediaSoup workers created - running in basic mode');
    }
  } catch (error) {
    console.error('Failed to initialize MediaSoup:', error);
    console.warn('Running without MediaSoup - video features will be limited');
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('create-room', async (data) => {
    // Generate 5-digit room ID
    const roomId = Math.floor(10000 + Math.random() * 90000).toString();
    rooms.set(roomId, {
      id: roomId,
      participants: new Map(),
      router: router || null
    });

    socket.join(roomId);
    socket.emit('room-created', { roomId });
    console.log('Room created:', roomId, router ? 'with MediaSoup' : 'without MediaSoup');
  });

  socket.on('get-router-rtp-capabilities', async (data, callback) => {
    const { roomId } = data;
    const room = rooms.get(roomId);

    if (!room) {
      callback({ error: 'Room not found' });
      return;
    }

    if (!room.router) {
      callback({ error: 'MediaSoup router not available' });
      return;
    }

    callback(room.router.rtpCapabilities);
  });

  socket.on('join-room', async (data) => {
    const { roomId, userName } = data;
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const participantId = uuidv4();
    const participant = {
      id: participantId,
      name: userName,
      socketId: socket.id,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map()
    };

    room.participants.set(participantId, participant);
    participants.set(socket.id, { roomId, participantId });

    socket.join(roomId);
    socket.emit('room-joined', { roomId, participantId });
    socket.to(roomId).emit('participant-joined', { participantId, userName });

    console.log(`Participant ${userName} joined room ${roomId}`);
  });

  socket.on('leave-room', (data) => {
    const { roomId, participantId } = data;
    const room = rooms.get(roomId);

    if (room && room.participants.has(participantId)) {
      const participant = room.participants.get(participantId);

      // Close all transports
      participant.transports.forEach(transport => {
        if (transport.close) transport.close();
      });

      room.participants.delete(participantId);
      participants.delete(socket.id);

      socket.to(roomId).emit('participant-left', { participantId });
      socket.leave(roomId);

      console.log(`Participant ${participantId} left room ${roomId}`);
    }
  });

  socket.on('create-transport', async (data, callback) => {
    const { roomId, participantId, direction } = data;
    const room = rooms.get(roomId);
    const participant = room?.participants.get(participantId);

    if (!participant) {
      callback({ error: 'Participant not found' });
      return;
    }

    if (!room.router) {
      callback({ error: 'MediaSoup not available - video features disabled' });
      return;
    }

    try {
      const transport = await createWebRtcTransport(room.router, direction);
      participant.transports.set(transport.id, transport);

      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      });
    } catch (error) {
      console.error('Failed to create transport:', error);
      callback({ error: 'Failed to create transport' });
    }
  });

  socket.on('connect-transport', async (data) => {
    const { roomId, participantId, transportId, dtlsParameters } = data;
    const room = rooms.get(roomId);
    const participant = room?.participants.get(participantId);
    const transport = participant?.transports.get(transportId);

    if (transport) {
      await transport.connect({ dtlsParameters });
    }
  });

  socket.on('produce', async (data, callback) => {
    const { roomId, participantId, transportId, kind, rtpParameters } = data;
    const room = rooms.get(roomId);
    const participant = room?.participants.get(participantId);
    const transport = participant?.transports.get(transportId);

    if (!transport) {
      callback({ error: 'Transport not found' });
      return;
    }

    try {
      const producer = await transport.produce({ kind, rtpParameters });
      participant.producers.set(producer.id, producer);

      callback({ id: producer.id });

      // Notify other participants
      socket.to(roomId).emit('new-producer', {
        producerId: producer.id,
        participantId,
        kind
      });
    } catch (error) {
      console.error('Failed to produce:', error);
      callback({ error: 'Failed to produce' });
    }
  });

  socket.on('consume', async (data, callback) => {
    const { roomId, participantId, producerId, transportId, rtpCapabilities } = data;
    const room = rooms.get(roomId);
    const participant = room?.participants.get(participantId);
    const transport = participant?.transports.get(transportId);

    if (!transport) {
      callback({ error: 'Transport not found' });
      return;
    }

    // Find producer
    let producer = null;
    for (const [pid, p] of room.participants) {
      if (p.producers.has(producerId)) {
        producer = p.producers.get(producerId);
        break;
      }
    }

    if (!producer) {
      callback({ error: 'Producer not found' });
      return;
    }

    try {
      const canConsume = await router.canConsume({
        producerId: producer.id,
        rtpCapabilities
      });

      if (!canConsume) {
        callback({ error: 'Cannot consume' });
        return;
      }

      const consumer = await transport.consume({
        producerId: producer.id,
        rtpCapabilities,
        paused: false
      });

      participant.consumers.set(consumer.id, consumer);

      callback({
        id: consumer.id,
        producerId: producer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters
      });
    } catch (error) {
      console.error('Failed to consume:', error);
      callback({ error: 'Failed to consume' });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    const participantInfo = participants.get(socket.id);
    if (participantInfo) {
      const { roomId, participantId } = participantInfo;
      const room = rooms.get(roomId);

      if (room && room.participants.has(participantId)) {
        const participant = room.participants.get(participantId);

        // Close all transports
        participant.transports.forEach(transport => {
          if (transport.close) transport.close();
        });

        room.participants.delete(participantId);
        socket.to(roomId).emit('participant-left', { participantId });
      }

      participants.delete(socket.id);
    }
  });
});

// Serve React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
});

const PORT = process.env.PORT || 8000;

async function startServer() {
  await initializeMediaSoup();

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch(console.error);
