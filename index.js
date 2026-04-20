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
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket'], // ✅ FIXED
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/build')));

const rooms = new Map();
const participants = new Map();

let workers = [];
let router;

async function initializeMediaSoup() {
  workers = await createWorkers();
  router = await createRouter(workers[0]);
  console.log('MediaSoup ready');
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('create-room', () => {
    const roomId = Math.floor(10000 + Math.random() * 90000).toString();

    rooms.set(roomId, {
      id: roomId,
      participants: new Map(),
      router
    });

    socket.join(roomId);
    socket.emit('room-created', { roomId });
  });

  socket.on('get-router-rtp-capabilities', ({ roomId }, callback) => {
    const room = rooms.get(roomId);
    callback(room?.router?.rtpCapabilities || {});
  });

  socket.on('join-room', ({ roomId, userName }) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit('error', { message: 'Room not found' });

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

    console.log(`${userName} joined ${roomId}`);
  });

  // ✅ NEW: get existing producers
  socket.on('get-producers', ({ roomId }, callback) => {
    const room = rooms.get(roomId);
    if (!room) return callback([]);

    const list = [];

    room.participants.forEach((p, pid) => {
      p.producers.forEach(prod => {
        list.push({
          producerId: prod.id,
          participantId: pid
        });
      });
    });

    callback(list);
  });

  socket.on('create-transport', async ({ roomId, participantId, direction }, callback) => {
    const room = rooms.get(roomId);
    const participant = room?.participants.get(participantId);

    if (!participant) return callback({ error: 'Participant not found' });

    const transport = await createWebRtcTransport(room.router);

    participant.transports.set(transport.id, transport);

    callback({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    });
  });

  // ✅ FIXED (callback added)
  socket.on('connect-transport', async (data, callback) => {
    const { roomId, participantId, transportId, dtlsParameters } = data;

    const transport = rooms
      .get(roomId)
      ?.participants.get(participantId)
      ?.transports.get(transportId);

    if (!transport) return callback({ error: 'Transport not found' });

    try {
      await transport.connect({ dtlsParameters });
      callback({ connected: true });
    } catch (err) {
      callback({ error: 'Connect failed' });
    }
  });

  socket.on('produce', async (data, callback) => {
    const { roomId, participantId, transportId, kind, rtpParameters } = data;

    const participant = rooms
      .get(roomId)
      ?.participants.get(participantId);

    const transport = participant?.transports.get(transportId);

    if (!transport) return callback({ error: 'Transport not found' });

    const producer = await transport.produce({ kind, rtpParameters });

    participant.producers.set(producer.id, producer);

    callback({ id: producer.id });

    socket.to(roomId).emit('new-producer', {
      producerId: producer.id,
      participantId,
      kind
    });
  });

  socket.on('consume', async (data, callback) => {
    const { roomId, participantId, producerId, transportId, rtpCapabilities } = data;

    const room = rooms.get(roomId);
    const participant = room?.participants.get(participantId);
    const transport = participant?.transports.get(transportId);

    if (!transport) return callback({ error: 'Transport not found' });

    let producer;

    room.participants.forEach(p => {
      if (p.producers.has(producerId)) {
        producer = p.producers.get(producerId);
      }
    });

    if (!producer) return callback({ error: 'Producer not found' });

    const canConsume = await room.router.canConsume({
      producerId,
      rtpCapabilities
    });

    if (!canConsume) return callback({ error: 'Cannot consume' });

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: false
    });

    participant.consumers.set(consumer.id, consumer);

    callback({
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters
    });
  });

  socket.on('resume-consumer', async ({ consumerId }) => {
    for (const room of rooms.values()) {
      for (const participant of room.participants.values()) {
        const consumer = participant.consumers.get(consumerId);
        if (consumer) {
          await consumer.resume();
        }
      }
    }
  });

  socket.on('disconnect', () => {
    const info = participants.get(socket.id);
    if (!info) return;

    const { roomId, participantId } = info;
    const room = rooms.get(roomId);

    if (room) {
      room.participants.delete(participantId);
      socket.to(roomId).emit('participant-left', { participantId });
    }

    participants.delete(socket.id);
  });
});

const PORT = process.env.PORT || 8000;

initializeMediaSoup().then(() => {
  server.listen(PORT, () => console.log(`Server running on ${PORT}`));
});