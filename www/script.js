/* globals Vue */

"use strict";

const App = Vue.createApp({
	data() {
		const channelId = window.location.pathname.substr(1);
		const channelLink = `${window.location.origin}/${channelId}`;
		const searchParams = new URLSearchParams(window.location.search);

		const name = searchParams.get("name");
		const chatEnabled = searchParams.get("chat") !== "false";
		const showHeader = searchParams.get("header") !== "false";

		return {
			channelId,
			channelLink,
			peerId: "",
			userAgent: "",
			audioDevices: [],
			videoDevices: [],
			audioEnabled: true,
			videoEnabled: true,
			showSettings: false,
			selectedAudioDeviceId: null,
			selectedVideoDeviceId: null,
			name: name ?? window.localStorage.name,
			callInitiated: false,
			localMediaStream: null,
			peers: {},
			dataChannels: {},
			showHeader,
			chatEnabled,
			chats: [],
			chatMessage: "",
			showChat: false,
			showReactionPanel: false,
			availableReactions: ["👍", "👏", "❤️", "😂", "😮", "��", "👋", "🤔"],
			toast: [{ type: "", message: "" }],
		};
	},
	computed: {
		peersArray() {
			return Object.keys(this.peers).map((peerId) => {
				const peer = this.peers[peerId];
				const isAudioMuted = peer.data.isAudioMuted ?? false;
				const isVideoMuted = peer.data.isVideoMuted ?? false;

				return {
					id: peerId,
					stream: peer.stream,
					name: peer.data.peerName,
					isTalking: peer.data.isTalking,
					isAudioMuted,
					isVideoMuted,
					latestReaction: peer.data.latestReaction,
				};
			});
		},
	},
	methods: {
		initiateCall() {
			if (!this.channelId) return alert("Invalid channel id");

			if (!this.name) return alert("Please enter your name");

			this.callInitiated = true;
			window.initiateCall();
		},
		setToast(message, type = "error") {
			this.toast = { type, message, time: new Date().getTime() };
			setTimeout(() => {
				if (new Date().getTime() - this.toast.time >= 3000) {
					this.toast.message = "";
				}
			}, 3500);
		},
		copyURL() {
			navigator.clipboard.writeText(this.channelLink).then(
				() => this.setToast("Channel URL copied 👍", "success"),
				() => this.setToast("Unable to copy channel URL")
			);
		},
		toggleAudio(e) {
			e.stopPropagation();
			if (this.audioEnabled) {
				this.stopAudio();
			} else {
				this.startAudio();
			}
		},
		toggleVideo(e) {
			e.stopPropagation();
			if (this.videoEnabled) {
				this.stopVideo();
			} else {
				this.startVideo();
			}
		},
		stopEvent(e) {
			e.preventDefault();
			e.stopPropagation();
		},
		updateName() {
			window.localStorage.name = this.name;
		},
		updateNameAndPublish() {
			window.localStorage.name = this.name;
			this.updateUserData("peerName", this.name);
		},
		updateUserData(key, value) {
			this.sendDataMessage(key, value);
		},
		formatDate(dateString) {
			const date = new Date(dateString);
			const hours = date.getHours() > 12 ? date.getHours() - 12 : date.getHours();
			return (
				(hours < 10 ? "0" + hours : hours) +
				":" +
				(date.getMinutes() < 10 ? "0" + date.getMinutes() : date.getMinutes()) +
				" " +
				(date.getHours() >= 12 ? "PM" : "AM")
			);
		},
		sanitizeString(str) {
			const tagsToReplace = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
			const replaceTag = (tag) => tagsToReplace[tag] || tag;
			const safe_tags_replace = (str) => str.replace(/[&<>]/g, replaceTag);
			return safe_tags_replace(str);
		},
		linkify(str) {
			return this.sanitizeString(str).replace(/(?:(?:https?|ftp):\/\/)?[\w/\-?=%.]+\.[\w/\-?=%]+/gi, (match) => {
				let displayURL = match.trim().replace("https://", "").replace("https://", "");
				displayURL = displayURL.length > 25 ? displayURL.substr(0, 25) + "&hellip;" : displayURL;
				const url = !/^https?:\/\//i.test(match) ? "http://" + match : match;
				return `<a href="${url}" target="_blank" class="link" rel="noopener">${displayURL}</a>`;
			});
		},
		sendChat(e) {
			e.stopPropagation();
			e.preventDefault();

			if (!this.chatMessage.length) return;

			if (Object.keys(this.peers).length > 0) {
				this.sendDataMessage("chat", this.chatMessage);
				this.chatMessage = "";
			} else {
				alert("No peers in the room");
			}
		},
		sendDataMessage(key, value) {
			const date = new Date().toISOString();
			const messagePayload = typeof value === 'object' ? JSON.stringify(value) : value;
			const dataMessage = { type: key, name: this.name, peerId: this.peerId, message: messagePayload, date };

			switch (key) {
				case "chat":
					dataMessage.message = this.linkify(value);
					this.chats.push(dataMessage);
					break;
				case "mute":
					break;
				case "reaction":
					this.displayReaction(this.peerId, value);
					break;
				default:
					break;
			}

			const serializedMessage = JSON.stringify(dataMessage);
			Object.keys(this.dataChannels).map((peer_id) => {
				if (this.dataChannels[peer_id]?.readyState === "open") {
					this.dataChannels[peer_id].send(serializedMessage);
				}
			});
		},
		setTalkingPeer(peerId, isTalking) {
			if (this.peers[peerId] && this.peers[peerId].data.isTalking !== isTalking) {
				this.peers[peerId].data.isTalking = isTalking;
			}
		},
		handleIncomingDataChannelMessage(rawMessage) {
			try {
				const dataMessage = JSON.parse(rawMessage.data);

				if (!dataMessage || !dataMessage.type || !dataMessage.peerId) {
					console.warn("Received invalid data message:", dataMessage);
					return;
				}
				if (!this.peers[dataMessage.peerId] && dataMessage.type !== 'peerName') {
					console.warn(`Peer ${dataMessage.peerId} not found for message type ${dataMessage.type}.`);
				}
				if (this.peers[dataMessage.peerId] && !this.peers[dataMessage.peerId].data) {
					 this.peers[dataMessage.peerId].data = { peerName: '...', isTalking: false, isAudioMuted: false, isVideoMuted: false, latestReaction: null };
				}

				switch (dataMessage.type) {
					case "peerName":
						const safeName = this.sanitizeString(dataMessage.message);
						if (this.peers[dataMessage.peerId]) {
							this.peers[dataMessage.peerId].data.peerName = safeName;
						} else {
							console.warn(`Received peerName for unknown peerId: ${dataMessage.peerId}. Name: ${safeName}`);
						}
						break;
					case "chat":
						this.showChat = true;
						dataMessage.message = this.linkify(dataMessage.message);
						this.chats.push(dataMessage);
						break;
					case "mute": {
						const muteInfo = JSON.parse(dataMessage.message);
						if (this.peers[dataMessage.peerId]?.data) {
							if (muteInfo.kind === "audio") {
								this.peers[dataMessage.peerId].data.isAudioMuted = muteInfo.status;
							} else if (muteInfo.kind === "video") {
								this.peers[dataMessage.peerId].data.isVideoMuted = muteInfo.status;
							}
						}
						break;
					}
					case "reaction":
						const safeReaction = this.sanitizeString(dataMessage.message);
						this.displayReaction(dataMessage.peerId, safeReaction);
						break;
					default:
						console.log("Unknown data message type:", dataMessage.type);
						break;
				}
			} catch (error) {
				console.error("Failed to parse incoming data message:", error, rawMessage.data);
			}
		},
		async stopAudio() {
			const audioTrack = this.localMediaStream?.getAudioTracks()[0];
			if (audioTrack) {
				audioTrack.stop();
				this.audioEnabled = false;
				this.sendDataMessage("mute", { kind: "audio", status: true });
			}
		},
		async startAudio() {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					audio: { deviceId: { exact: this.selectedAudioDeviceId } },
					video: false,
				});
				const newAudioTrack = stream.getAudioTracks()[0];

				const oldTrack = this.localMediaStream?.getAudioTracks()[0];
				if (oldTrack) {
					this.localMediaStream.removeTrack(oldTrack);
				}
				this.localMediaStream.addTrack(newAudioTrack);

				for (const peerId in this.peers) {
					const sender = this.peers[peerId].pc
						.getSenders()
						.find((s) => s.track?.kind === "audio");
					if (sender) {
						await sender.replaceTrack(newAudioTrack);
					} else {
						this.peers[peerId].pc.addTrack(newAudioTrack, this.localMediaStream);
					}
				}

				this.audioEnabled = true;
				this.sendDataMessage("mute", { kind: "audio", status: false });
			} catch (error) {
				console.error("Error starting audio:", error);
				this.setToast("Error enabling audio. Please check permissions.");
				this.audioEnabled = false;
			}
		},
		async stopVideo() {
			const videoTrack = this.localMediaStream?.getVideoTracks()[0];
			if (videoTrack) {
				videoTrack.stop();
				this.videoEnabled = false;
				this.sendDataMessage("mute", { kind: "video", status: true });

				const localVideo = document.getElementById("localVideo");
				if (localVideo) localVideo.srcObject = null;
			}
		},
		async startVideo() {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					audio: false,
					video: { deviceId: { exact: this.selectedVideoDeviceId } },
				});
				const newVideoTrack = stream.getVideoTracks()[0];

				const oldTrack = this.localMediaStream?.getVideoTracks()[0];
				if (oldTrack) {
					this.localMediaStream.removeTrack(oldTrack);
				}
				this.localMediaStream.addTrack(newVideoTrack);

				const localVideo = document.getElementById("localVideo");
				if (localVideo) {
					const displayStream = new MediaStream([newVideoTrack]);
					localVideo.srcObject = displayStream;
				}

				for (const peerId in this.peers) {
					const sender = this.peers[peerId].pc
						.getSenders()
						.find((s) => s.track?.kind === "video");
					if (sender) {
						await sender.replaceTrack(newVideoTrack);
					} else {
						this.peers[peerId].pc.addTrack(newVideoTrack, this.localMediaStream);
					}
				}

				this.videoEnabled = true;
				this.sendDataMessage("mute", { kind: "video", status: false });
			} catch (error) {
				console.error("Error starting video:", error);
				this.setToast("Error enabling video. Please check permissions.");
				this.videoEnabled = false;
			}
		},
		toggleReactionPanel() {
			this.showReactionPanel = !this.showReactionPanel;
		},
		sendReaction(reactionType) {
			this.showReactionPanel = false; // Hide panel after selection
			this.sendDataMessage("reaction", reactionType);
		},
		displayReaction(peerId, reactionType) {
			if (!this.peers[peerId]) return;
			
			const reactionId = Date.now();
			this.peers[peerId].data.latestReaction = {
				type: reactionType,
				id: reactionId,
				name: this.peers[peerId].data.peerName || 'Unknown'
			};
			
			setTimeout(() => {
				if (this.peers[peerId]?.data.latestReaction?.id === reactionId) {
					this.peers[peerId].data.latestReaction = null;
				}
			}, 4000);
		},
	},
	watch: {
		peers: {
			handler(newPeers, oldPeers) {
				Object.keys(newPeers).forEach(peerId => {
					if (!oldPeers[peerId] && newPeers[peerId]) {
						if (!newPeers[peerId].data) {
							this.$set(newPeers[peerId], 'data', {
								peerName: '...',
								isTalking: false,
								isAudioMuted: false,
								isVideoMuted: false,
								latestReaction: null
							});
						} else {
							if (newPeers[peerId].data.isAudioMuted === undefined) this.$set(newPeers[peerId].data, 'isAudioMuted', false);
							if (newPeers[peerId].data.isVideoMuted === undefined) this.$set(newPeers[peerId].data, 'isVideoMuted', false);
							if (newPeers[peerId].data.latestReaction === undefined) this.$set(newPeers[peerId].data, 'latestReaction', null);
						}
					}
				});
			},
			deep: true
		}
	}
}).mount("#app");

const setTheme = (themeColor) => {
	if (!themeColor) return null;
	if (!/^[0-9A-F]{6}$/i.test(themeColor)) return alert("Invalid theme color");

	const textColor = parseInt(themeColor, 16) > 0xffffff / 2 ? "#000" : "#fff";

	document.documentElement.style.setProperty("--background", `#${themeColor}`);
	document.documentElement.style.setProperty("--text", textColor);
};

(async () => {
	const searchParams = new URLSearchParams(window.location.search);
	const themeColor = searchParams.get("theme");

	if (themeColor) setTheme(themeColor);

	if ("serviceWorker" in navigator) {
		navigator.serviceWorker.register("/sw.js");
	}

	await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
	const devices = await navigator.mediaDevices.enumerateDevices();
	App.audioDevices = devices.filter((device) => device.kind === "audioinput");
	App.videoDevices = devices.filter((device) => device.kind === "videoinput");

	const defaultAudioDeviceId = App.audioDevices.find((device) => device.deviceId == "default")?.deviceId;
	const defaultVideoDeviceId = App.videoDevices.find((device) => device.deviceId == "default")?.deviceId;

	App.selectedAudioDeviceId = defaultAudioDeviceId ?? App.audioDevices[0].deviceId;
	App.selectedVideoDeviceId = defaultVideoDeviceId ?? App.videoDevices[0].deviceId;

	try {
		App.localMediaStream = await navigator.mediaDevices.getUserMedia({
			audio: { deviceId: { ideal: App.selectedAudioDeviceId } },
			video: { deviceId: { ideal: App.selectedVideoDeviceId } }
		});

		App.audioEnabled = true;
		App.videoEnabled = true;

		const localVideo = document.getElementById("localVideo");
		if (localVideo) {
			localVideo.srcObject = App.localMediaStream;
			localVideo.muted = true;
		}

	} catch (error) {
		console.error("Error getting initial media:", error);
		App.setToast("Error accessing camera or microphone. Please check permissions.");
		App.audioEnabled = false;
		App.videoEnabled = false;
	}
})();
