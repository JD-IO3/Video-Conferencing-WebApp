import { useEffect, useRef } from 'react';
import useMedia from './useMedia';
import { useParams } from 'react-router-dom';

const useVideoFunctions = () => {
    const {
        socketRef,
        deviceRef,
        producerTransportRef,
        consumerTransportsRef,
        audioParamsRef,
        videoParamsRef,
        audioProducerRef,
        videoProducerRef,
    } = useMedia();

    const { meetingId } = useParams();

    let consumingTransports = [];

    const createSendTransport = () => {
        socketRef.current.emit(
            "createWebRtcTransport",
            { consumer: false },
            ({ params }) => {
                if (params.error) {
                    console.log(params.error);
                    return;
                }

                producerTransportRef.current = deviceRef.current.createSendTransport(params);

                producerTransportRef.current.on(
                    "connect",
                    async ({ dtlsParameters }, callback, errback) => {
                        try {
                            await socketRef.current.emit("transport-connect", {
                                dtlsParameters,
                            });
                            callback();
                        } catch (error) {
                            errback(error);
                        }
                    }
                );

                producerTransportRef.current.on(
                    "produce",
                    async (parameters, callback, errback) => {
                        try {
                            await socketRef.current.emit(
                                "transport-produce",
                                {
                                    kind: parameters.kind,
                                    rtpParameters: parameters.rtpParameters,
                                    appData: parameters.appData,
                                },
                                ({ id, producersExist }) => {
                                    callback({ id });
                                    if (producersExist) getProducers();
                                }
                            );
                        } catch (error) {
                            errback(error);
                        }
                    }
                );

                if (socketRef.current) connectSendTransport();
            }
        );
    };

    const connectSendTransport = async () => {
        audioProducerRef.current = await producerTransportRef.current.produce(audioParamsRef.current);
        videoProducerRef.current = await producerTransportRef.current.produce(videoParamsRef.current);

        audioProducerRef.current.on("trackended", () => {
            console.log("audio track ended");
        });

        audioProducerRef.current.on("transportclose", () => {
            console.log("audio transport ended");
        });

        videoProducerRef.current.on("trackended", () => {
            console.log("video track ended");
        });

        videoProducerRef.current.on("transportclose", () => {
            console.log("video transport ended");
        });
    };

    const signalNewConsumerTransport = async (remoteProducerId) => {
        if (consumingTransports.includes(remoteProducerId)) return;
        consumingTransports.push(remoteProducerId);

        await socketRef.current.emit(
            "createWebRtcTransport",
            { consumer: true },
            ({ params }) => {
                if (params.error) {
                    console.log(params.error);
                    return;
                }

                let consumerTransport;
                try {
                    consumerTransport = deviceRef.current.createRecvTransport(params);
                } catch (error) {
                    console.log(error);
                    return;
                }

                consumerTransport.on(
                    "connect",
                    async ({ dtlsParameters }, callback, errback) => {
                        try {
                            await socketRef.current.emit("transport-recv-connect", {
                                dtlsParameters,
                                serverConsumerTransportId: params.id,
                            });
                            callback();
                        } catch (error) {
                            errback(error);
                        }
                    }
                );

                if (socketRef.current) connectRecvTransport(consumerTransport, remoteProducerId, params.id);
            }
        );
    };

    const getProducers = () => {
        socketRef.current.emit("getProducers", (producerIds) => {
            producerIds.forEach((producerId) => signalNewConsumerTransport(producerId));
        });
    };

    const connectRecvTransport = async (
        consumerTransport,
        remoteProducerId,
        serverConsumerTransportId
    ) => {
        await socketRef.current.emit(
            "consume",
            {
                rtpCapabilities: deviceRef.current.rtpCapabilities,
                remoteProducerId,
                serverConsumerTransportId,
            },
            async ({ params }) => {
                if (params.error) {
                    console.log("Cannot Consume");
                    return;
                }

                const consumer = await consumerTransport.consume({
                    id: params.id,
                    producerId: params.producerId,
                    kind: params.kind,
                    rtpParameters: params.rtpParameters,
                });

                consumerTransportsRef.current = [
                    ...consumerTransportsRef.current,
                    {
                        consumerTransport,
                        serverConsumerTransportId: params.id,
                        producerId: remoteProducerId,
                        consumer,
                    },
                ];

                const newElem = document.createElement("div");
                newElem.setAttribute("id", `td-${remoteProducerId}`);

                if (params.kind == "audio") {
                    newElem.innerHTML = '<audio id="' + remoteProducerId + '" autoplay></audio>';
                } else {
                    newElem.setAttribute("class", "remoteVideo");
                    newElem.innerHTML = '<video id="' + remoteProducerId + '" autoplay ></video>';
                }

                videoContainer.appendChild(newElem);

                const { track } = consumer;
                document.getElementById(remoteProducerId).srcObject = new MediaStream([track]);

                socketRef.current.emit("consumer-resume", {
                    serverConsumerId: params.serverConsumerId,
                    meetingId
                });
            }
        );
    };

    return {
        createSendTransport,
        connectSendTransport,
        signalNewConsumerTransport,
        getProducers,
        connectRecvTransport
    };
};

export default useVideoFunctions;
