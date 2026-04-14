const mediasoup = require('mediasoup');

const config = {
  worker: {
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp'
    ],
  },
  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000
        }
      },
      {
        kind: 'video',
        mimeType: 'video/VP9',
        clockRate: 90000,
        parameters: {
          'profile-id': 2,
          'x-google-start-bitrate': 1000
        }
      },
      {
        kind: 'video',
        mimeType: 'video/h264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '4d0032',
          'x-google-start-bitrate': 1000
        }
      },
      {
        kind: 'video',
        mimeType: 'video/h264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '42e01f',
          'x-google-start-bitrate': 1000
        }
      }
    ]
  },
  webRtcTransport: {
    listenIps: [
      { ip: '0.0.0.0', announcedIp: null }
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1000000,
    minimumAvailableOutgoingBitrate: 600000,
    maxSctpMessageSize: 262144,
    sendBufferSize: 262144,
    recvBufferSize: 262144
  },
  plainTransport: {
    listenIp: '0.0.0.0'
  }
};

async function createWorkers() {
  const workers = [];
  const numWorkers = 1;

  for (let i = 0; i < numWorkers; i++) {
    try {
      const worker = await mediasoup.createWorker({
        rtcMinPort: config.worker.rtcMinPort,
        rtcMaxPort: config.worker.rtcMaxPort,
        logLevel: config.worker.logLevel,
        logTags: config.worker.logTags
      });

      worker.on('died', () => {
        console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
        setTimeout(() => process.exit(1), 2000);
      });

      workers.push(worker);
      console.log('MediaSoup worker created successfully');
    } catch (error) {
      console.error('Failed to create MediaSoup worker:', error);
      throw error;
    }
  }

  return workers;
}

async function createRouter(worker) {
  const router = await worker.createRouter({
    mediaCodecs: config.router.mediaCodecs
  });

  return router;
}

async function createWebRtcTransport(router, direction = 'send') {
  const transportOptions = {
    ...config.webRtcTransport,
    direction: direction
  };

  const transport = await router.createWebRtcTransport(transportOptions);

  transport.on('dtlsstatechange', (dtlsState) => {
    if (dtlsState === 'closed') {
      transport.close();
    }
  });

  transport.on('icestatechange', (iceState) => {
    console.log('ICE state changed:', iceState);
  });

  return transport;
}

module.exports = {
  createWorkers,
  createRouter,
  createWebRtcTransport
};
