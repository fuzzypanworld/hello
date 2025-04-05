/* globals App, io */
"use strict";

const SIGNALLING_SERVER = window.origin;
const ICE_SERVERS = [
	{ urls: "stun:stun.l.google.com:19302" },
	{ urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
];
const VOLUME_THRESHOLD = 24;
const AUDIO_WINDOW_SIZE = 256;

let signalingSocket = null; /* our socket.io connection to our webserver */
let audioStreams = new Map(); // Holds audio stream related data for each stream

// ICE configuration with STUN and TURN servers
const iceConfiguration = {
	iceServers: [
		{ urls: 'stun:stun.l.google.com:19302' },
		{ urls: 'stun:stun1.l.google.com:19302' },
		{ urls: 'stun:stun2.l.google.com:19302' },
		{ urls: 'stun:stun3.l.google.com:19302' },
		{ urls: 'stun:stun4.l.google.com:19302' }
	]
};

// Initialize socket connection
const socket = io(window.location.origin, {
	transports: ['websocket'],
	upgrade: false
});

// Peer connection management
let peerConnections = {};
let localStream = null;
let dataChannel = null;

window.initiateCall = () => {
	App.userAgent = navigator.userAgent;
	signalingSocket = io(SIGNALLING_SERVER);

	signalingSocket.on("connect", () => {
		App.peerId = signalingSocket.id;

		const userData = { peerName: App.name, userAgent: App.userAgent };

		if (App.localMediaStream) joinChatChannel(App.channelId, userData);
		else setupLocalMedia(() => joinChatChannel(App.channelId, userData));
	});

	signalingSocket.on("disconnect", () => {
		for (let peer_id in App.peers) {
			App.peers[peer_id]["rtc"].close();
		}
		App.peers = {};
	});

	const joinChatChannel = (channel, userData) => signalingSocket.emit("join", { channel, userData });

	signalingSocket.on("addPeer", (config) => {
		const peer_id = config.peer_id;
		if (peer_id in App.peers) return;

		const peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
		App.peers[peer_id] = { ...App.peers[peer_id], data: config.channel[peer_id].userData };
		App.peers[peer_id]["rtc"] = peerConnection;

		peerConnection.onicecandidate = (event) => {
			if (event.candidate) {
				signalingSocket.emit("relayICECandidate", {
					peer_id,
					ice_candidate: { sdpMLineIndex: event.candidate.sdpMLineIndex, candidate: event.candidate.candidate },
				});
			}
		};

		peerConnection.onaddstream = (event) => {
			if (!App.peers[peer_id]["data"].userAgent) return;
			App.peers[peer_id]["stream"] = event.stream;

			// Used talk detection from https://www.linkedin.com/pulse/webrtc-active-speaker-detection-nilesh-gawande/
			handleAudioStream(event.stream, peer_id);
		};

		peerConnection.ondatachannel = (event) => {
			event.channel.onmessage = (msg) => {
				try {
					App.handleIncomingDataChannelMessage(JSON.parse(msg.data));
				} catch (err) {
					console.log(err);
				}
			};
		};

		peerConnection.addStream(App.localMediaStream);
		App.dataChannels[peer_id] = peerConnection.createDataChannel("ot__data_channel");

		if (config.should_create_offer) {
			peerConnection.onnegotiationneeded = () => {
				peerConnection
					.createOffer()
					.then((localDescription) => {
						peerConnection
							.setLocalDescription(localDescription)
							.then(() => {
								signalingSocket.emit("relaySessionDescription", {
									peer_id: peer_id,
									session_description: localDescription,
								});
							})
							.catch(() => App.setToast("Offer setLocalDescription failed!"));
					})
					.catch((error) => console.log("Error sending offer: ", error));
			};
		}
	});

	signalingSocket.on("sessionDescription", (config) => {
		const peer_id = config.peer_id;
		const peer = App.peers[peer_id]["rtc"];
		const remoteDescription = config.session_description;

		const desc = new RTCSessionDescription(remoteDescription);
		peer.setRemoteDescription(
			desc,
			() => {
				if (remoteDescription.type == "offer") {
					peer.createAnswer(
						(localDescription) => {
							peer.setLocalDescription(
								localDescription,
								() =>
									signalingSocket.emit("relaySessionDescription", { peer_id, session_description: localDescription }),
								() => App.setToast("Answer setLocalDescription failed!")
							);
						},
						(error) => console.log("Error creating answer: ", error)
					);
				}
			},
			(error) => console.log("setRemoteDescription error: ", error)
		);
	});

	signalingSocket.on("iceCandidate", (config) => {
		const peer = App.peers[config.peer_id]["rtc"];
		const iceCandidate = config.ice_candidate;
		peer.addIceCandidate(new RTCIceCandidate(iceCandidate)).catch((error) => {
			console.log("Error addIceCandidate", error);
		});
	});

	signalingSocket.on("removePeer", (config) => {
		const peer_id = config.peer_id;
		if (peer_id in App.peers) {
			App.peers[peer_id]["rtc"].close();
		}
		delete App.dataChannels[peer_id];
		delete App.peers[peer_id];
		removeAudioStream(peer_id);
	});
};

function setupLocalMedia(callback) {
	if (App.localMediaStream != null) {
		if (callback) callback();
		return;
	}

	navigator.mediaDevices
		.getUserMedia({ audio: { deviceId: App.selectedAudioDeviceId }, video: { deviceId: App.selectedVideoDeviceId } })
		.then((stream) => {
			App.localMediaStream = stream;
			if (callback) callback();
		})
		.catch((error) => {
			console.error(error);
			App.setToast("Unable to get microphone access.");
		});
}

function handleAudioStream(stream, peerId) {
	// Is peer talking analyser from https://www.linkedin.com/pulse/webrtc-active-speaker-detection-nilesh-gawande/
	const audioContext = new AudioContext();
	const mediaStreamSource = audioContext.createMediaStreamSource(stream);
	const analyserNode = audioContext.createAnalyser();
	analyserNode.fftSize = AUDIO_WINDOW_SIZE;
	mediaStreamSource.connect(analyserNode);
	const bufferLength = analyserNode.frequencyBinCount;
	const dataArray = new Uint8Array(bufferLength);
	function processAudio() {
		analyserNode.getByteFrequencyData(dataArray);
		const averageVolume = dataArray.reduce((acc, val) => acc + val, 0) / bufferLength;
		App.setTalkingPeer(peerId, averageVolume > VOLUME_THRESHOLD);
		requestAnimationFrame(processAudio);
	}
	processAudio();
	audioStreams.set(peerId, { stream, analyserNode });
}

function removeAudioStream(peerId) {
	const streamData = audioStreams.get(peerId);
	if (streamData) {
		streamData.stream.getTracks().forEach((track) => track.stop());
		streamData.analyserNode.disconnect();
		audioStreams.delete(peerId);
	}
}

// Socket event handlers
socket.on('connect', () => {
	console.log('Connected to signaling server');
});

socket.on('disconnect', () => {
	console.log('Disconnected from signaling server');
});

socket.on('peer-joined', async (peerId) => {
	console.log('Peer joined:', peerId);
	await createPeerConnection(peerId, true);
});

socket.on('peer-left', (peerId) => {
	console.log('Peer left:', peerId);
	removePeerConnection(peerId);
});

socket.on('signal', async ({ from, signal }) => {
	console.log('Received signal from peer:', from);
	try {
		if (!peerConnections[from]) {
			await createPeerConnection(from, false);
		}
		await handleSignal(from, signal);
	} catch (error) {
		console.error('Error handling signal:', error);
	}
});

// Create and manage peer connections
async function createPeerConnection(peerId, isInitiator) {
	try {
		const peerConnection = new RTCPeerConnection(iceConfiguration);
		peerConnections[peerId] = peerConnection;

		// Set up event handlers
		peerConnection.onicecandidate = (event) => {
			if (event.candidate) {
				socket.emit('signal', {
					to: peerId,
					signal: {
						type: 'candidate',
						candidate: event.candidate
					}
				});
			}
		};

		peerConnection.ontrack = (event) => {
			console.log('Received remote track');
			const stream = event.streams[0];
			const videoElement = document.getElementById(`video-${peerId}`);
			if (videoElement) {
				videoElement.srcObject = stream;
			}
		};

		peerConnection.onconnectionstatechange = () => {
			console.log(`Connection state for peer ${peerId}:`, peerConnection.connectionState);
		};

		// Add local tracks
		if (localStream) {
			localStream.getTracks().forEach(track => {
				peerConnection.addTrack(track, localStream);
			});
		}

		// Create data channel
		if (isInitiator) {
			dataChannel = peerConnection.createDataChannel('data');
			setupDataChannel(dataChannel);
		} else {
			peerConnection.ondatachannel = (event) => {
				dataChannel = event.channel;
				setupDataChannel(dataChannel);
			};
		}

		// Create and send offer if initiator
		if (isInitiator) {
			const offer = await peerConnection.createOffer();
			await peerConnection.setLocalDescription(offer);
			socket.emit('signal', {
				to: peerId,
				signal: {
					type: 'offer',
					sdp: offer
				}
			});
		}

		return peerConnection;
	} catch (error) {
		console.error('Error creating peer connection:', error);
		throw error;
	}
}

// Handle incoming signals
async function handleSignal(peerId, signal) {
	const peerConnection = peerConnections[peerId];
	if (!peerConnection) return;

	try {
		if (signal.type === 'offer') {
			await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
			const answer = await peerConnection.createAnswer();
			await peerConnection.setLocalDescription(answer);
			socket.emit('signal', {
				to: peerId,
				signal: {
					type: 'answer',
					sdp: answer
				}
			});
		} else if (signal.type === 'answer') {
			await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
		} else if (signal.type === 'candidate') {
			await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
		}
	} catch (error) {
		console.error('Error handling signal:', error);
	}
}

// Set up data channel
function setupDataChannel(channel) {
	channel.onopen = () => {
		console.log('Data channel opened');
	};

	channel.onclose = () => {
		console.log('Data channel closed');
	};

	channel.onmessage = (event) => {
		if (window.app) {
			window.app.handleIncomingDataChannelMessage(event);
		}
	};
}

// Remove peer connection
function removePeerConnection(peerId) {
	const peerConnection = peerConnections[peerId];
	if (peerConnection) {
		peerConnection.close();
		delete peerConnections[peerId];
	}
}

// Join a channel
async function joinChannel(channelId, stream) {
	localStream = stream;
	socket.emit('join-channel', channelId);
}

// Set up local media
async function setupLocalMedia(constraints = { audio: true, video: true }) {
	try {
		const stream = await navigator.mediaDevices.getUserMedia(constraints);
		const videoElement = document.getElementById('localVideo');
		if (videoElement) {
			videoElement.srcObject = stream;
		}
		return stream;
	} catch (error) {
		console.error('Error accessing media devices:', error);
		throw error;
	}
}

// Audio analysis for active speaker detection
function setupAudioAnalysis(stream) {
	const audioContext = new AudioContext();
	const analyser = audioContext.createAnalyser();
	const microphone = audioContext.createMediaStreamSource(stream);
	microphone.connect(analyser);
	
	analyser.fftSize = 256;
	const bufferLength = analyser.frequencyBinCount;
	const dataArray = new Uint8Array(bufferLength);
	
	function checkAudioLevel() {
		analyser.getByteFrequencyData(dataArray);
		const average = dataArray.reduce((a, b) => a + b) / bufferLength;
		const isSpeaking = average > 30; // Adjust threshold as needed
		
		if (window.app) {
			window.app.updateSpeakingState(isSpeaking);
		}
		
		requestAnimationFrame(checkAudioLevel);
	}
	
	checkAudioLevel();
}

// Export functions
window.rtcUtils = {
	joinChannel,
	setupLocalMedia,
	setupAudioAnalysis
};
