const mediasoup = require('mediasoup');
const os = require('os');

const rtcMinPort = Number(process.env.MEDIASOUP_MIN_PORT || 40000);
const rtcMaxPort = Number(process.env.MEDIASOUP_MAX_PORT || 49999);

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const ifaces of Object.values(interfaces)) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const announcedIp = process.env.MEDIASOUP_ANNOUNCED_IP || getLocalIp();
console.log('MediaSoup announced IP:', announcedIp);

const config = {
  worker: {
    rtcMinPort,
    rtcMaxPort,
    logLevel: 'warn',
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp']
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
      },
      {
        kind: 'video',
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '42e01f',
          'level-asymmetry-allowed': 1
        }
      }
    ]
  },

  webRtcTransport: {
    listenIps: [{ ip: '0.0.0.0', announcedIp }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 2_500_000,
    maxIncomingBitrate: 3_000_000
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
  return worker.createRouter({
    mediaCodecs: config.router.mediaCodecs
  });
}

async function createWebRtcTransport(router) {
  const transport = await router.createWebRtcTransport(config.webRtcTransport);

  transport.on('dtlsstatechange', (dtlsState) => {
    if (dtlsState === 'closed') {
      transport.close();
    }
  });

  transport.on('icestatechange', (iceState) => {
    console.log('ICE state:', transport.id, iceState);
  });

  return transport;
}

module.exports = {
  createWorkers,
  createRouter,
  createWebRtcTransport
};
