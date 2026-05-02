const mediasoup = require('mediasoup');

const rtcMinPort = Number(process.env.MEDIASOUP_MIN_PORT || 40000);
const rtcMaxPort = Number(process.env.MEDIASOUP_MAX_PORT || 49999);
ANNOUNCED_IP = 'groupvideonode.onrender.com'

const config = {
  worker: {
    rtcMinPort,
    rtcMaxPort,
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
        announcedIp: '103.79.170.130'
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

  transport.on('dtlsstatechange', (state) => {
    if (state === 'closed') transport.close();
  });

  return transport;
}

module.exports = {
  createWorkers,
  createRouter,
  createWebRtcTransport
};
