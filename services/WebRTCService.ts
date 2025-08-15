import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    mediaDevices,
    MediaStream,
    RTCConfiguration,
    RTCIceCandidate,
    RTCPeerConnection,
    RTCSessionDescription,
} from 'react-native-webrtc';

export interface CallDevice {
  audioDeviceId?: string;
  videoDeviceId?: string;
  speakerDeviceId?: string;
}

export interface CallConfig {
  iceServers: RTCConfiguration['iceServers'];
}

export class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private isCallActive = false;
  private callStartTime: number | null = null;
  
  // Event callbacks
  public onLocalStream?: (stream: MediaStream) => void;
  public onRemoteStream?: (stream: MediaStream) => void;
  public onCallStateChange?: (state: 'connecting' | 'connected' | 'disconnected' | 'failed') => void;
  public onIceCandidate?: (candidate: RTCIceCandidate) => void;
  public onCallEnd?: () => void;

  constructor(private config: CallConfig) {}

  async initializeCall(callType: 'audio' | 'video', devices?: CallDevice): Promise<MediaStream> {
    try {
      // Create peer connection
      this.peerConnection = new RTCPeerConnection({
        iceServers: this.config.iceServers,
      });

      this.setupPeerConnectionListeners();

      // Get user media with selected devices
      const constraints = {
        audio: devices?.audioDeviceId 
          ? { deviceId: { exact: devices.audioDeviceId } }
          : {
              channelCount: 2,
              sampleRate: 48000,
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
        video: callType === 'video' 
          ? devices?.videoDeviceId 
            ? { deviceId: { exact: devices.videoDeviceId } }
            : {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 },
              }
          : false,
      };

      this.localStream = await mediaDevices.getUserMedia(constraints);
      
      // Add tracks to peer connection
      this.localStream.getTracks().forEach(track => {
        this.peerConnection?.addTrack(track, this.localStream!);
      });

      // Save device preferences
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

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.onIceCandidate?.(event.candidate);
      }
    };

    this.peerConnection.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
        this.onRemoteStream?.(this.remoteStream);
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;
      console.log('ICE connection state:', state);
      
      switch (state) {
        case 'connected':
          this.isCallActive = true;
          this.callStartTime = Date.now();
          this.onCallStateChange?.(state);
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          this.onCallStateChange?.(state);
          if (state === 'failed' || state === 'closed') {
            this.endCall();
          }
          break;
        default:
          this.onCallStateChange?.('connecting');
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      console.log('Connection state:', state);
      
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        this.endCall();
      }
    };
  }

  async createOffer(): Promise<RTCSessionDescription> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    const offer = await this.peerConnection.createOffer();
    // Enable stereo audio
    offer.sdp = this.enableStereoInSDP(offer.sdp || '');
    await this.peerConnection.setLocalDescription(offer);
    return offer;
  }

  async createAnswer(offer: RTCSessionDescription): Promise<RTCSessionDescription> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    await this.peerConnection.setRemoteDescription(offer);
    const answer = await this.peerConnection.createAnswer();
    // Enable stereo audio
    answer.sdp = this.enableStereoInSDP(answer.sdp || '');
    await this.peerConnection.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(answer: RTCSessionDescription) {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    await this.peerConnection.setRemoteDescription(answer);
  }

  async addIceCandidate(candidate: RTCIceCandidate) {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    await this.peerConnection.addIceCandidate(candidate);
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

        // Replace track in peer connection
        const sender = this.peerConnection.getSenders().find(
          s => s.track && s.track.kind === 'audio'
        );
        if (sender) {
          await sender.replaceTrack(newAudioTrack);
        }

        // Stop old track
        oldAudioTrack.stop();

        // Save preference
        await AsyncStorage.setItem('preferredAudioDevice', deviceId);
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
    console.log('Ending call...');
    
    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Reset state
    this.isCallActive = false;
    this.callStartTime = null;
    this.remoteStream = null;

    this.onCallEnd?.();
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

  private async saveDevicePreferences(devices: CallDevice): Promise<void> {
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

      return {
        audioDeviceId: audioDeviceId || undefined,
        videoDeviceId: videoDeviceId || undefined,
        speakerDeviceId: speakerDeviceId || undefined,
      };
    } catch (error) {
      console.error('Error getting device preferences:', error);
      return {};
    }
  }
}
