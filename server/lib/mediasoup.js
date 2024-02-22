const mediasoup = require('mediasoup');

let rooms = {}; // { meetingId1: { Router, rooms: [ sicketId1, ... ] }, ...}
let peers = {}; // { socketId1: { meetingId1, socket, transports = [id1, id2,] }, producers = [id1, id2,] }, consumers = [id1, id2,], peerDetails }, ...}
let transports = []; // [ { socketId1, meetingId1, transport, consumer }, ... ]
let producers = []; // [ { socketId1, meetingId1, producer, }, ... ]
let consumers = []; // [ { socketId1, meetingId1, consumer, }, ... ]

//? This is an Array of RtpCapabilities
//? https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/#RtpCodecCapability
//? list of media codecs supported by mediasoup ...
//? https://github.com/versatica/mediasoup/blob/v3/src/supportedRtpCapabilities.ts
const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];


const createWorker = async () => {
  const worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 3000,
  });
  console.log(`worker pid ${worker.pid}`);

  worker.on("died", (error) => {
    // This implies something serious happened, so kill the application
    console.error("mediasoup worker has died");
    setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
  });

  return worker;
};

const workerPromise =  createWorker();

async function mediasoupProcess (socket) {
  const worker = await workerPromise;
  
  const createRoom = async (meetingId, socketId) => {
    // worker.createRouter(options)
    // options = { mediaCodecs, appData }
    // mediaCodecs -> defined above
    // appData -> custom application data - we are not supplying any
    // none of the two are required
    // console.log(meetingId);
    // console.log(socketId);
    let router1;
    let peers = [];
    console.log(rooms);
    if (rooms[meetingId]) {
      router1 = rooms[meetingId].router;
      peers = rooms[meetingId].peers || [];
    } else {
      console.log(worker);
      router1 = await worker.createRouter({ mediaCodecs });
    }
  
    console.log(`Router ID: ${router1.id}`, peers.length);
  
    rooms[meetingId] = {
      router: router1,
      peers: [...peers, socketId],
    };
  
    return router1;
  };
  
  const removeItems = (items, socketId, type) => {
    //? For Removing items like, producers, consumers and transports..
    items.forEach((item) => {
      if (item.socketId === socket.id) {
        item[type].close();
      }
    });
    items = items.filter((item) => item.socketId !== socket.id);
  
    //? Returning items after removing particular item..
    return items;
  };
  
  //? Methods for adding producers, consumers and transports
  const addTransport = (transport, meetingId, consumer) => {
    transports = [
      ...transports,
      { socketId: socket.id, transport, meetingId, consumer },
    ];
  
    peers[socket.id] = {
      ...peers[socket.id],
      transports: [...peers[socket.id].transports, transport.id],
    };
  };
  
  const addProducer = (producer, meetingId) => {
    producers = [...producers, { socketId: socket.id, producer, meetingId }];
  
    peers[socket.id] = {
      ...peers[socket.id],
      producers: [...peers[socket.id].producers, producer.id],
    };
  };
  
  const addConsumer = (consumer, meetingId) => {
    // add the consumer to the consumers list
    consumers = [...consumers, { socketId: socket.id, consumer, meetingId }];
  
    // add the consumer id to the peers list
    peers[socket.id] = {
      ...peers[socket.id],
      consumers: [...peers[socket.id].consumers, consumer.id],
    };
  };
  
  const informConsumers = (meetingId, socketId, id) => {
    console.log(`just joined, id ${id} ${meetingId}, ${socketId}`);
    // A new producer just joined
    // let all consumers to consume this producer
    producers.forEach((producerData) => {
      if (
        producerData.socketId !== socketId &&
        producerData.meetingId === meetingId
      ) {
        const producerSocket = peers[producerData.socketId].socket;
        // use socket to send producer id to producer
        producerSocket.emit("new-producer", { producerId: id });
      }
    });
  };
  
  const getTransport = (socketId) => {
    const [producerTransport] = transports.filter(
      (transport) => transport.socketId === socketId && !transport.consumer
    );
    return producerTransport.transport;
  };
  
  //? To create a WebRtcTransport for created router..
  const createWebRtcTransport = async (router) => {
    return new Promise(async (resolve, reject) => {
      try {
        //? https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
        const webRtcTransport_options = {
          listenIps: [
            {
              ip: "127.0.0.1", //? replace with relevant IP address
              // announcedIp: '192.168.0.106',
            },
          ],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
        };
  
        //? https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport
        let transport = await router.createWebRtcTransport(
          webRtcTransport_options
        );
        console.log(`transport id: ${transport.id}`);

        
  
        transport.on("dtlsstatechange", (dtlsState) => {
          if (dtlsState === "closed") {
            transport.close();
          }
        });
  
        transport.on("close", () => {
          console.log("transport closed");
        });
  
        resolve(transport);
      } catch (error) {
        reject(error);
      }
    });
  };

  //? Listen for joining room event..
  socket.on("joinRoom", async ({ meetingId }, callback) => {
    //? create Router if it does not exist
    // console.log('joinroom');
    console.log('this is room: ', rooms[meetingId]);
    const router =
      (rooms[meetingId] && rooms[meetingId].router) ||
      (await createRoom(meetingId, socket.id));
    // const router = await createRoom(meetingId, socket.id)

    peers[socket.id] = {
      socket,
      meetingId, //? Name for the Router this Peer joined
      transports: [],
      producers: [],
      consumers: [],
      peerDetails: {
        name: "",
        isAdmin: false, //? Is this Peer the Admin?
      },
    };

    //? get Router RTP Capabilities
    const rtpCapabilities = router.rtpCapabilities;

    //? call callback from the client and send back the rtpCapabilities
    callback({ rtpCapabilities });
  });

  socket.on("createWebRtcTransport", async ({ consumer }, callback) => {
    // get Room Name from Peer's properties
    const meetingId = peers[socket.id].meetingId;

    // get Router (Room) object this peer is in based on meetingId
    const router = rooms[meetingId].router;

    createWebRtcTransport(router).then(
      (transport) => {
        callback({
          params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          },
        });

        // add transport to Peer's properties
        addTransport(transport, meetingId, consumer);
      },
      (error) => {
        console.log(error);
      }
    );
  });

  socket.on("getProducers", (callback) => {
    //return all producer transports
    const { meetingId } = peers[socket.id];

    let producerList = [];
    producers.forEach((producerData) => {
      if (
        producerData.socketId !== socket.id &&
        producerData.meetingId === meetingId
      ) {
        producerList = [...producerList, producerData.producer.id];
      }
    });

    // return the producer list back to the client
    callback(producerList);
  });

  // see client's socket.emit('transport-connect', ...)
  socket.on("transport-connect", ({ dtlsParameters }) => {
    console.log("DTLS PARAMS... ", { dtlsParameters });

    getTransport(socket.id).connect({ dtlsParameters });
  });

  // see client's socket.emit('transport-produce', ...)
  socket.on(
    "transport-produce",
    async ({ kind, rtpParameters, appData }, callback) => {
      // call produce based on the prameters from the client
      const producer = await getTransport(socket.id).produce({
        kind,
        rtpParameters,
      });

      // add producer to the producers array
      const { meetingId } = peers[socket.id];

      addProducer(producer, meetingId);

      informConsumers(meetingId, socket.id, producer.id);

      console.log("Producer ID: ", producer.id, producer.kind);

      producer.on("transportclose", () => {
        console.log("transport for this producer closed ");
        producer.close();
      });

      // Send back to the client the Producer's id
      callback({
        id: producer.id,
        producersExist: producers.length > 1 ? true : false,
      });
    }
  );

  // see client's socket.emit('transport-recv-connect', ...)
  socket.on(
    "transport-recv-connect",
    async ({ dtlsParameters, serverConsumerTransportId }) => {
      console.log("DTLS PARAMS: ", { dtlsParameters });
      const consumerTransport = transports.find(
        (transportData) =>
          transportData.consumer &&
          transportData.transport.id == serverConsumerTransportId
      ).transport;
      await consumerTransport.connect({ dtlsParameters });
    }
  );

  socket.on(
    "consume",
    async (
      { rtpCapabilities, remoteProducerId, serverConsumerTransportId },
      callback
    ) => {
      try {
        const { meetingId } = peers[socket.id];
        const router = rooms[meetingId].router;
        let consumerTransport = transports.find(
          (transportData) =>
            transportData.consumer &&
            transportData.transport.id == serverConsumerTransportId
        ).transport;

        // check if the router can consume the specified producer
        if (
          router.canConsume({
            producerId: remoteProducerId,
            rtpCapabilities,
          })
        ) {
          // transport can now consume and return a consumer
          const consumer = await consumerTransport.consume({
            producerId: remoteProducerId,
            rtpCapabilities,
            paused: true,
          });

          consumer.on("transportclose", () => {
            console.log("transport close from consumer");
          });

          consumer.on("producerclose", () => {
            console.log("producer of consumer closed");
            socket.emit("producer-closed", { remoteProducerId });

            consumerTransport.close([]);
            transports = transports.filter(
              (transportData) =>
                transportData.transport.id !== consumerTransport.id
            );
            consumer.close();
            consumers = consumers.filter(
              (consumerData) => consumerData.consumer.id !== consumer.id
            );
          });

          addConsumer(consumer, meetingId);

          // from the consumer extract the following params
          // to send back to the Client
          const params = {
            id: consumer.id,
            producerId: remoteProducerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            serverConsumerId: consumer.id,
          };

          // send the parameters to the client
          callback({ params });
        }
      } catch (error) {
        console.log(error.message);
        callback({
          params: {
            error: error,
          },
        });
      }
    }
  );

  socket.on("consumer-resume", async ({ serverConsumerId }) => {
    console.log("consumer resume");
    const { consumer } = consumers.find(
      (consumerData) => consumerData.consumer.id === serverConsumerId
    );
    await consumer.resume();
  });

  //? Listen for the disconnect event..
  socket.on("disconnect", () => {
    //? do some cleanup
    console.log("peer disconnected");
    consumers = removeItems(consumers, socket.id, "consumer");
    producers = removeItems(producers, socket.id, "producer");
    transports = removeItems(transports, socket.id, "transport");

    const { meetingId } = peers[socket.id];
    delete peers[socket.id];

    //? remove socket from room
    rooms[meetingId] = {
      router: rooms[meetingId].router,
      peers: rooms[meetingId].peers.filter((socketId) => socketId !== socket.id),
    };
  });
};

module.exports = {
  mediasoupProcess,
};