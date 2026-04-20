const mediasoup = require('mediasoup');

const config = {
  worker: {
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
    logLevel: 'warn',
    logTags: ['info', 'ice', 'dtls']
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
        clockRate: 90000
      }
    ]
  },
  webRtcTransport: {
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: 'YOUR_PUBLIC_IP_OR_DOMAIN' // 🔥 REQUIRED in production
      }
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true
  }
};

async function createWorkers() {
  const worker = await mediasoup.createWorker(config.worker);

  worker.on('died', () => {
    console.error('Worker died');
    process.exit(1);
  });

  return [worker];
}

async function createRouter(worker) {
  return await worker.createRouter({
    mediaCodecs: config.router.mediaCodecs
  });
}

async function createWebRtcTransport(router) {
  const transport = await router.createWebRtcTransport(config.webRtcTransport);

  transport.on('dtlsstatechange', state => {
    if (state === 'closed') transport.close();
  });

  return transport;
}

module.exports = {
  createWorkers,
  createRouter,
  createWebRtcTransport
};