import AsyncStorage from '@react-native-async-storage/async-storage';
import { ICEServerService } from './ICEServerService';
import {
    mediaDevices,
    MediaStream,
    RTCIceCandidate,
    RTCPeerConnection,
    RTCSessionDescription,
} from 'react-native-webrtc';

// Define RTCConfiguration interface for react-native-webrtc
interface RTCConfiguration {
  iceServers?: RTCIceServer[];
  iceTransportPolicy?: 'all' | 'relay';
  bundlePolicy?: 'balanced' | 'max-compat' | 'max-bundle';
  rtcpMuxPolicy?: 'negotiate' | 'require';
}

export interface RTCIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// Type extensions for react-native-webrtc
interface ReactNativeRTCPeerConnection extends RTCPeerConnection {
  onicecandidate: ((event: any) => void) | null;
  onaddstream: ((event: any) => void) | null;
  oniceconnectionstatechange: (() => void) | null;
  addStream: (stream: MediaStream) => void;
  removeStream: (stream: MediaStream) => void;
}

export interface CallDevice {
  audioDeviceId?: string;
  videoDeviceId?: string;
  speakerDeviceId?: string;
}

export interface CallConfig {
  iceServers?: RTCIceServer[];
  apiBaseUrl: string;
}

export class WebRTCService {
  private peerConnection: ReactNativeRTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private isCallActive = false;
  private callStartTime: number | null = null;
  private isEnding = false;
  
  // ICE candidate queuing (like working web implementation)
  private candidateQueue: RTCIceCandidate[] = [];
  private remoteDescriptionSet = false;
  
  // Event callbacks
  public onLocalStream?: (stream: MediaStream) => void;
  public onRemoteStream?: (stream: MediaStream) => void;
  public onCallStateChange?: (state: 'connecting' | 'connected' | 'disconnected' | 'failed') => void;
  public onIceCandidate?: (candidate: RTCIceCandidate) => void;
  public onCallEnd?: () => void;

  constructor(private config: CallConfig) {}

  async initializeICEServers(): Promise<RTCIceServer[]> {
    console.log('WebRTCService: Fetching ICE servers from backend:', this.config.apiBaseUrl);
    const servers = await ICEServerService.getICEServers(this.config.apiBaseUrl);
    console.log('WebRTCService: Retrieved ICE servers:', JSON.stringify(servers, null, 2));
    
    // Log each server type for debugging
    servers.forEach((server, index) => {
      console.log(`ICE Server ${index + 1}:`, {
        urls: server.urls,
        hasCredentials: !!(server.username && server.credential),
        username: server.username ? `${server.username.substring(0, 8)}...` : 'none',
      });
    });
    
    return servers;
  }

  async initializeCall(callType: 'audio' | 'video', devices?: CallDevice): Promise<MediaStream> {
    try {
      // Get ICE servers (STUN/TURN)
      const iceServers = await this.initializeICEServers();
      console.log('WebRTCService: Using ICE servers:', iceServers);

      // Create peer connection
      this.peerConnection = new RTCPeerConnection({
        iceServers,
      }) as ReactNativeRTCPeerConnection;

      this.setupPeerConnectionListeners();

      // Load saved device preferences if no devices specified
      let finalDevices = devices;
      if (!devices) {
        finalDevices = await this.getDevicePreferences();
      }

      // Get user media with selected devices
      const constraints = {
        audio: finalDevices?.audioDeviceId 
          ? { deviceId: { exact: finalDevices.audioDeviceId } }
          : {
              channelCount: 2,
              sampleRate: 48000,
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
        video: callType === 'video' 
          ? finalDevices?.videoDeviceId 
            ? { deviceId: { exact: finalDevices.videoDeviceId } }
            : {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 },
              }
          : false,
      };

      this.localStream = await mediaDevices.getUserMedia(constraints);
      
      // Add stream to peer connection
      if (this.peerConnection && this.localStream) {
        this.peerConnection.addStream(this.localStream);
      }

      // Save device preferences if provided
      if (devices) {
        await this.saveDevicePreferences(devices);
      }

      this.onLocalStream?.(this.localStream);
      return this.localStream;
    } catch (error) {
      console.error('Error initializing call:', error);
      throw error;
    }
  }

  private setupPeerConnectionListeners() {
    if (!this.peerConnection) return;

    this.peerConnection.onicecandidate = (event: any) => {
      if (event.candidate) {
        console.log('WebRTCService: Generated ICE candidate:', {
          candidate: event.candidate.candidate,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          sdpMid: event.candidate.sdpMid,
          usernameFragment: event.candidate.usernameFragment,
        });
        this.onIceCandidate?.(event.candidate);
      } else {
        console.log('WebRTCService: ICE candidate gathering complete');
      }
    };

    this.peerConnection.onaddstream = (event: any) => {
      if (event.stream) {
        this.remoteStream = event.stream;
        if (this.remoteStream) {
          this.onRemoteStream?.(this.remoteStream);
        }
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;
      const gatheringState = this.peerConnection?.iceGatheringState;
      console.log('WebRTCService: ICE connection state changed:', {
        connectionState: state,
        gatheringState: gatheringState,
        timestamp: new Date().toISOString(),
      });
      
      switch (state) {
        case 'connected':
          console.log('WebRTCService: ICE connection established successfully!');
          this.isCallActive = true;
          this.callStartTime = Date.now();
          this.onCallStateChange?.(state);
          break;
        case 'checking':
          console.log('WebRTCService: ICE connectivity checks in progress...');
          this.onCallStateChange?.('connecting');
          break;
        case 'completed':
          console.log('WebRTCService: ICE connection completed!');
          this.onCallStateChange?.('connected');
          break;
        case 'disconnected':
          console.log('WebRTCService: ICE connection disconnected');
          this.onCallStateChange?.(state);
          break;
        case 'failed':
          console.error('WebRTCService: ICE connection failed!');
          this.onCallStateChange?.(state);
          if (!this.isEnding) {
            this.endCall();
          }
          break;
        case 'closed':
          console.log('WebRTCService: ICE connection closed');
          break;
        default:
          console.log('WebRTCService: ICE connection state:', state);
          this.onCallStateChange?.('connecting');
      }
    };

    // Note: connectionstatechange may not be available in react-native-webrtc
    // Relying on iceconnectionstatechange for state management
  }

  async createOffer(): Promise<RTCSessionDescription> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    // Log current peer connection state
    console.log('WebRTCService: Creating offer with current state:', {
      iceConnectionState: this.peerConnection.iceConnectionState,
      iceGatheringState: this.peerConnection.iceGatheringState,
      signalingState: this.peerConnection.signalingState,
    });

    const offer = await this.peerConnection.createOffer({});
    // Enable stereo audio
    const sessionDescription = offer as RTCSessionDescription;
    if (sessionDescription && sessionDescription.sdp) {
      const modifiedSdp = this.enableStereoInSDP(sessionDescription.sdp);
      const modifiedOffer = {
        type: sessionDescription.type,
        sdp: modifiedSdp
      } as RTCSessionDescription;
      await this.peerConnection.setLocalDescription(modifiedOffer);
      return modifiedOffer;
    }
    await this.peerConnection.setLocalDescription(sessionDescription);
    return sessionDescription;
  }

  async createAnswer(offer: RTCSessionDescription): Promise<RTCSessionDescription> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    console.log('WebRTCService: Setting remote description (offer)');
    await this.peerConnection.setRemoteDescription(offer);
    this.remoteDescriptionSet = true;
    
    // Process queued ICE candidates after setting remote description
    console.log(`WebRTCService: Processing ${this.candidateQueue.length} queued ICE candidates`);
    for (const candidate of this.candidateQueue) {
      try {
        await this.peerConnection.addIceCandidate(candidate);
        console.log('WebRTCService: Added queued ICE candidate:', candidate.candidate);
      } catch (error) {
        console.error('WebRTCService: Error adding queued ICE candidate:', error);
      }
    }
    this.candidateQueue = []; // Clear the queue
    
    const answer = await this.peerConnection.createAnswer({});
    // Enable stereo audio
    const sessionDescription = answer as RTCSessionDescription;
    if (sessionDescription && sessionDescription.sdp) {
      const modifiedSdp = this.enableStereoInSDP(sessionDescription.sdp);
      const modifiedAnswer = {
        type: sessionDescription.type,
        sdp: modifiedSdp
      } as RTCSessionDescription;
      await this.peerConnection.setLocalDescription(modifiedAnswer);
      return modifiedAnswer;
    }
    await this.peerConnection.setLocalDescription(sessionDescription);
    return sessionDescription;
  }

  async handleAnswer(answer: RTCSessionDescription) {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    console.log('WebRTCService: Setting remote description (answer)');
    await this.peerConnection.setRemoteDescription(answer);
    this.remoteDescriptionSet = true;
    
    // Process queued ICE candidates after setting remote description
    console.log(`WebRTCService: Processing ${this.candidateQueue.length} queued ICE candidates`);
    for (const candidate of this.candidateQueue) {
      try {
        await this.peerConnection.addIceCandidate(candidate);
        console.log('WebRTCService: Added queued ICE candidate:', candidate.candidate);
      } catch (error) {
        console.error('WebRTCService: Error adding queued ICE candidate:', error);
      }
    }
    this.candidateQueue = []; // Clear the queue
  }

  async addIceCandidate(candidate: RTCIceCandidate): Promise<void> {
    if (!this.peerConnection) {
      console.warn('WebRTCService: Cannot add ICE candidate - peer connection not initialized');
      return;
    }

    // Queue ICE candidates if remote description is not set yet (like working web implementation)
    if (!this.remoteDescriptionSet) {
      console.log('WebRTCService: Queueing ICE candidate (remote description not set yet):', candidate.candidate);
      this.candidateQueue.push(candidate);
      return;
    }

    try {
      await this.peerConnection.addIceCandidate(candidate);
      console.log('WebRTCService: Added ICE candidate immediately:', {
        candidate: candidate.candidate,
        sdpMLineIndex: candidate.sdpMLineIndex,
        sdpMid: candidate.sdpMid,
      });
    } catch (error) {
      console.error('WebRTCService: Error adding ICE candidate:', error);
    }
  }

  toggleMute(): boolean {
    if (!this.localStream) return false;

    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled; // Return true if muted
    }
    return false;
  }

  toggleVideo(): boolean {
    if (!this.localStream) return false;

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      return !videoTrack.enabled; // Return true if video is off
    }
    return false;
  }

  async switchCamera(): Promise<void> {
    if (!this.localStream) return;

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      // For React Native WebRTC, we can use switchCamera method
      // This is a simplified version - actual implementation may vary
      try {
        // @ts-ignore - switchCamera might not be in types but exists in implementation
        if (videoTrack._switchCamera) {
          videoTrack._switchCamera();
        }
      } catch (error) {
        console.error('Error switching camera:', error);
      }
    }
  }

  async switchAudioDevice(deviceId: string): Promise<void> {
    if (!this.localStream || !this.peerConnection) return;

    try {
      // Get new audio stream
      const newStream = await mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
        video: false,
      });

      const newAudioTrack = newStream.getAudioTracks()[0];
      const oldAudioTrack = this.localStream.getAudioTracks()[0];

      if (newAudioTrack && oldAudioTrack) {
        // Replace track in local stream
        this.localStream.removeTrack(oldAudioTrack);
        this.localStream.addTrack(newAudioTrack);

        // Replace stream in peer connection
        // Note: getSenders may not be available in react-native-webrtc
        // Using removeStream/addStream approach instead
        const oldStream = this.localStream;
        this.peerConnection.removeStream(oldStream);
        this.peerConnection.addStream(this.localStream);
        // Stop old track
        oldAudioTrack.stop();

        // Save preference
        await this.saveDevicePreferences({ audioDeviceId: deviceId });
      }
    } catch (error) {
      console.error('Error switching audio device:', error);
      throw error;
    }
  }

  getCallDuration(): string {
    if (!this.callStartTime) return '00:00';
    
    const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  isAudioMuted(): boolean {
    if (!this.localStream) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    return audioTrack ? !audioTrack.enabled : false;
  }

  isVideoMuted(): boolean {
    if (!this.localStream) return false;
    const videoTrack = this.localStream.getVideoTracks()[0];
    return videoTrack ? !videoTrack.enabled : false;
  }

  endCall(): void {
    if (this.isEnding) {
      console.log('Call already ending, skipping...');
      return;
    }
    
    this.isEnding = true;
    console.log('Ending call...');
    
    try {
      // Stop local stream
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (error) {
            console.warn('Error stopping track:', error);
          }
        });
        this.localStream = null;
      }

      // Close peer connection
      if (this.peerConnection) {
        try {
          this.peerConnection.close();
        } catch (error) {
          console.warn('Error closing peer connection:', error);
        }
        this.peerConnection = null;
      }

      // Reset state
      this.isCallActive = false;
      this.callStartTime = null;
      this.remoteStream = null;
      
      // Reset ICE candidate queuing state
      this.candidateQueue = [];
      this.remoteDescriptionSet = false;

      // Call the callback after a small delay to ensure cleanup is complete
      setTimeout(() => {
        this.onCallEnd?.();
        this.isEnding = false;
      }, 100);
    } catch (error) {
      console.error('Error during call cleanup:', error);
      this.isEnding = false;
    }
  }

  private enableStereoInSDP(sdp: string): string {
    // Find Opus payload type
    const rtpmap = sdp.match(/a=rtpmap:(\d+) opus\/48000\/?\d*/);
    if (!rtpmap) {
      console.warn('No Opus rtpmap found in SDP!');
      return sdp;
    }

    const opusPT = rtpmap[1];
    
    // Patch the fmtp line for Opus
    const fmtpRegex = new RegExp(`a=fmtp:${opusPT} ([^\r\n]*)`, 'g');
    const patched = sdp.replace(fmtpRegex, (match, params) => {
      let newParams = params;
      if (!/stereo=1/.test(params)) {
        newParams = 'stereo=1; sprop-stereo=1; ' + newParams;
      }
      return `a=fmtp:${opusPT} ${newParams}`;
    });

    return patched;
  }

  async saveDevicePreferences(devices: CallDevice): Promise<void> {
    try {
      if (devices.audioDeviceId) {
        await AsyncStorage.setItem('preferredAudioDevice', devices.audioDeviceId);
      }
      if (devices.videoDeviceId) {
        await AsyncStorage.setItem('preferredVideoDevice', devices.videoDeviceId);
      }
      if (devices.speakerDeviceId) {
        await AsyncStorage.setItem('preferredSpeakerDevice', devices.speakerDeviceId);
      }
      console.log('WebRTCService: Device preferences saved:', devices);
    } catch (error) {
      console.error('Error saving device preferences:', error);
    }
  }

  async getDevicePreferences(): Promise<CallDevice> {
    try {
      const [audioDeviceId, videoDeviceId, speakerDeviceId] = await Promise.all([
        AsyncStorage.getItem('preferredAudioDevice'),
        AsyncStorage.getItem('preferredVideoDevice'),
        AsyncStorage.getItem('preferredSpeakerDevice'),
      ]);

      const preferences = {
        audioDeviceId: audioDeviceId || undefined,
        videoDeviceId: videoDeviceId || undefined,
        speakerDeviceId: speakerDeviceId || undefined,
      };
      
      console.log('WebRTCService: Loaded device preferences:', preferences);
      return preferences;
    } catch (error) {
      console.error('Error getting device preferences:', error);
      return {};
    }
  }
}
