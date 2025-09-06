import AsyncStorage from '@react-native-async-storage/async-storage';
import { ICEServerService } from './ICEServerService';
import {
    mediaDevices,
    MediaStream,
    RTCIceCandidate,
    RTCPeerConnection,
    RTCSessionDescription,
} from 'react-native-webrtc';
import { Platform } from 'react-native';
import { BuildUtils, debugLog, releaseLog, errorLog } from '../utils/buildUtils';

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
  ontrack: ((event: any) => void) | null;
  oniceconnectionstatechange: (() => void) | null;
  // Modern APIs used instead of deprecated addStream/removeStream
  addTrack: (track: any, stream: MediaStream) => any; // RTCRtpSender
  getSenders: () => any[]; // RTCRtpSender[]
}

// Local type for SDP-like objects passed from web
type SessionDescriptionLike = { type: 'offer' | 'answer'; sdp: string };

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
  private screenStream: MediaStream | null = null;
  private isCallActive = false;
  private callStartTime: number | null = null;
  private isEnding = false;
  private screenSharingActive = false;
  
  // ICE candidate queuing (like working web implementation)
  private candidateQueue: RTCIceCandidate[] = [];
  private remoteDescriptionSet = false;
  private processingRemoteDescription = false;
  
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
      console.log('[INIT] WebRTCService: Starting call initialization for type:', callType);
      
      // Get ICE servers (STUN/TURN) with timeout and error handling
      let iceServers: RTCIceServer[];
      try {
        iceServers = await Promise.race([
          this.initializeICEServers(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('ICE server fetch timeout')), 10000)
          )
        ]);
        console.log('[INIT] WebRTCService: Successfully retrieved ICE servers:', iceServers.length);
      } catch (iceError) {
        console.error('[INIT] WebRTCService: ICE server fetch failed:', iceError);
        // Use fallback STUN servers for basic connectivity
        iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
        console.warn('[INIT] WebRTCService: Using fallback STUN servers');
      }

      // Create peer connection with build-aware configuration
      const webrtcConfig = BuildUtils.getWebRTCConfig();
      const rtcConfig = {
        iceServers,
        iceTransportPolicy: webrtcConfig.iceTransportPolicy as 'all' | 'relay',
        bundlePolicy: webrtcConfig.bundlePolicy as 'balanced' | 'max-compat' | 'max-bundle',
        rtcpMuxPolicy: webrtcConfig.rtcpMuxPolicy as 'negotiate' | 'require'
      };
      
      debugLog('WebRTCService: Creating peer connection with config:', rtcConfig);
      
      try {
        this.peerConnection = new RTCPeerConnection(rtcConfig) as ReactNativeRTCPeerConnection;
        releaseLog('WebRTCService: PeerConnection created successfully for release build');
      } catch (pcError) {
        errorLog('WebRTCService: PeerConnection creation failed', pcError);
        throw new Error(`Failed to create peer connection: ${pcError}`);
      }

      this.setupPeerConnectionListeners();

      // Process any queued ICE candidates now that peer connection is initialized
      if (this.candidateQueue.length > 0) {
        console.log(`[INIT] WebRTCService: Processing ${this.candidateQueue.length} ICE candidates queued before peer connection initialization`);
        // Note: We still need to wait for remote description before actually adding them
        // The candidates will be processed when createAnswer/handleAnswer sets the remote description
      }

      // Load saved device preferences if no devices specified
      let finalDevices = devices;
      if (!devices) {
        try {
          finalDevices = await this.getDevicePreferences();
          console.log('[INIT] WebRTCService: Loaded device preferences:', finalDevices);
        } catch (prefError) {
          console.warn('[INIT] WebRTCService: Failed to load device preferences:', prefError);
          finalDevices = {};
        }
      }

      // Get user media with build-aware constraints
      const wantVideo = callType === 'video';
      const useDeviceIdForVideo = !!finalDevices?.videoDeviceId;
      // Reuse webrtcConfig from above
      
      const constraints = {
        audio: finalDevices?.audioDeviceId
          ? { deviceId: { exact: finalDevices.audioDeviceId } }
          : {
              channelCount: 2,
              sampleRate: 48000,
              echoCancellation: webrtcConfig.enableEchoCancellation,
              noiseSuppression: webrtcConfig.enableNoiseSuppression,
              autoGainControl: webrtcConfig.enableAutoGainControl,
              ...(webrtcConfig.enableHighpassFilter && { googHighpassFilter: true }),
              ...(webrtcConfig.enableDtx && { googDtx: true }),
            },
        video: wantVideo
          ? useDeviceIdForVideo
            ? { deviceId: { exact: finalDevices!.videoDeviceId! } }
            : {
                width: { ideal: 1280, min: 640 },
                height: { ideal: 720, min: 480 },
                frameRate: { ideal: 30, min: 15 },
                // Prefer front camera by default when no selection provided
                facingMode: 'user',
              }
          : false,
      } as const;

      console.log('[INIT] WebRTCService: Requesting user media with constraints:', constraints);
      
      try {
        this.localStream = await mediaDevices.getUserMedia(constraints);
        console.log('[INIT] WebRTCService: Got local stream with tracks:', 
          this.localStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled })));
      } catch (mediaError) {
        console.error('[INIT] WebRTCService: getUserMedia failed:', mediaError);
        // Try with basic constraints as fallback
        try {
          const fallbackConstraints = {
            audio: true,
            video: wantVideo ? { facingMode: 'user' } : false
          };
          console.log('[INIT] WebRTCService: Retrying with fallback constraints:', fallbackConstraints);
          this.localStream = await mediaDevices.getUserMedia(fallbackConstraints);
          console.log('[INIT] WebRTCService: Fallback media request successful');
        } catch (fallbackError) {
          console.error('[INIT] WebRTCService: Fallback media request also failed:', fallbackError);
          const errorMessage = mediaError instanceof Error ? mediaError.message : String(mediaError);
          throw new Error(`Media access failed: ${errorMessage}`);
        }
      }
      
      // Attach local tracks to peer connection (modern API) with error handling
      if (this.peerConnection && this.localStream) {
        const pc = this.peerConnection;
        const ls = this.localStream;
        let tracksAdded = 0;
        
        ls.getTracks().forEach((track: any) => {
          try {
            pc.addTrack(track, ls as any);
            tracksAdded++;
            console.log('[INIT] WebRTCService: Added track:', track.kind, 'enabled:', track.enabled);
          } catch (trackError) {
            console.error('[INIT] WebRTCService: addTrack failed for track', track?.kind, trackError);
            throw new Error(`Failed to add ${track?.kind} track: ${trackError}`);
          }
        });
        
        console.log('[INIT] WebRTCService: Successfully added', tracksAdded, 'tracks to peer connection');
      }

      // Save device preferences if provided
      if (devices) {
        try {
          await this.saveDevicePreferences(devices);
          console.log('[INIT] WebRTCService: Saved device preferences');
        } catch (saveError) {
          console.warn('[INIT] WebRTCService: Failed to save device preferences:', saveError);
        }
      }

      this.onLocalStream?.(this.localStream);
      console.log('[INIT] WebRTCService: Call initialization completed successfully');
      return this.localStream;
    } catch (error) {
      console.error('[INIT] WebRTCService: Call initialization failed:', error);
      // Cleanup on failure
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (stopError) {
            console.warn('[INIT] Cleanup: Failed to stop track:', stopError);
          }
        });
        this.localStream = null;
      }
      if (this.peerConnection) {
        try {
          this.peerConnection.close();
        } catch (closeError) {
          console.warn('[INIT] Cleanup: Failed to close peer connection:', closeError);
        }
        this.peerConnection = null;
      }
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

    // Use ontrack (modern API) instead of deprecated onaddstream
    this.peerConnection.ontrack = (event: any) => {
      try {
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
        }
        if (event.streams && event.streams[0]) {
          // Prefer stream provided by the event when available
          this.remoteStream = event.streams[0];
        } else if (event.track) {
          // Fallback: manually compose remote stream
          // Ensure the track isn't already added
          const exists = this.remoteStream.getTracks().some((t) => t.id === event.track.id);
          if (!exists) {
            this.remoteStream.addTrack(event.track);
          }
        }
        if (this.remoteStream) {
          this.onRemoteStream?.(this.remoteStream);
        }
      } catch (err) {
        console.warn('WebRTCService: Error handling ontrack event', err);
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

  async createAnswer(offer: RTCSessionDescription | RTCSessionDescriptionInit): Promise<RTCSessionDescription> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    console.log('WebRTCService: Setting remote description (offer)');
    // Set processing flag BEFORE any async operations to prevent race conditions
    this.processingRemoteDescription = true;
    this.remoteDescriptionSet = false; // Ensure it's false during processing
    
    try {
      // Normalize to object with required sdp field and cast to satisfy RN types
      const normalizedOffer: any = (offer as any).sdp
        ? offer
        : { type: (offer as any).type, sdp: (offer as any).sdp };
      await this.peerConnection.setRemoteDescription(normalizedOffer as any);
      this.remoteDescriptionSet = true;
    } catch (error) {
      this.processingRemoteDescription = false;
      this.remoteDescriptionSet = false;
      throw error;
    } finally {
      // Always reset processing flag
      this.processingRemoteDescription = false;
    }
    
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
    
    const answer = await this.peerConnection.createAnswer();
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

  async handleAnswer(answer: RTCSessionDescription | RTCSessionDescriptionInit) {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    console.log('WebRTCService: Setting remote description (answer)');
    // Set processing flag BEFORE any async operations to prevent race conditions
    this.processingRemoteDescription = true;
    this.remoteDescriptionSet = false; // Ensure it's false during processing
    
    try {
      const normalizedAnswer: any = (answer as any).sdp
        ? answer
        : { type: (answer as any).type, sdp: (answer as any).sdp };
      await this.peerConnection.setRemoteDescription(normalizedAnswer as any);
      this.remoteDescriptionSet = true;
    } catch (error) {
      this.processingRemoteDescription = false;
      this.remoteDescriptionSet = false;
      throw error;
    } finally {
      // Always reset processing flag
      this.processingRemoteDescription = false;
    }
    
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
    // Validate candidate before processing
    if (!candidate) {
      console.warn('[ICE] WebRTCService: Invalid ICE candidate received (null/undefined)');
      return;
    }
    
    // Queue ICE candidates if peer connection is not initialized, remote description is not set, or we're processing remote description
    if (!this.peerConnection || !this.remoteDescriptionSet || this.processingRemoteDescription) {
      const reason = !this.peerConnection 
        ? 'peer connection not initialized' 
        : !this.remoteDescriptionSet 
        ? 'remote description not set yet'
        : 'processing remote description';
      console.log(`[ICE] WebRTCService: Queueing ICE candidate (${reason}):`, candidate.candidate?.substring(0, 50) + '...');
      
      // Prevent queue overflow in case of issues
      if (this.candidateQueue.length > 50) {
        console.warn('[ICE] WebRTCService: ICE candidate queue is getting large, removing oldest');
        this.candidateQueue.shift();
      }
      
      this.candidateQueue.push(candidate);
      return;
    }

    // Add candidate immediately with comprehensive error handling
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount <= maxRetries) {
      try {
        await this.peerConnection.addIceCandidate(candidate);
        console.log('[ICE] WebRTCService: Added ICE candidate successfully:', {
          candidate: candidate.candidate?.substring(0, 50) + '...',
          sdpMLineIndex: candidate.sdpMLineIndex,
          sdpMid: candidate.sdpMid,
          retryCount
        });
        return; // Success, exit retry loop
      } catch (error: any) {
        retryCount++;
        console.error(`[ICE] WebRTCService: Error adding ICE candidate (attempt ${retryCount}/${maxRetries + 1}):`, {
          error: error.message || error,
          candidate: candidate.candidate?.substring(0, 50) + '...',
          connectionState: this.peerConnection.iceConnectionState,
          signalingState: this.peerConnection.signalingState
        });
        
        // If this is the last retry, log and continue (don't throw)
        if (retryCount > maxRetries) {
          console.error('[ICE] WebRTCService: Failed to add ICE candidate after all retries, continuing anyway');
          return;
        }
        
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
      }
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

      if (newAudioTrack) {
        // Replace track in local stream
        if (oldAudioTrack) {
          this.localStream.removeTrack(oldAudioTrack);
        }
        this.localStream.addTrack(newAudioTrack);

        // Replace sender track on the peer connection (modern API)
        const sender = this.peerConnection.getSenders().find((s: any) => s.track && s.track.kind === 'audio');
        if (sender && sender.replaceTrack) {
          await sender.replaceTrack(newAudioTrack);
        } else {
          console.warn('WebRTCService: getSenders/replaceTrack not available; audio device switch may not propagate');
        }

        // Stop old track after replacement
        if (oldAudioTrack) {
          try {
            oldAudioTrack.stop();
          } catch (e) {
            console.warn('Error stopping old audio track:', e);
          }
        }

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

  isScreenSharing(): boolean {
    return this.screenSharingActive;
  }

  async startScreenShare(): Promise<MediaStream> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    try {
      console.log('WebRTCService: Starting screen share...');
      
      // Get screen capture stream
      this.screenStream = await mediaDevices.getDisplayMedia();

      console.log('WebRTCService: Screen stream obtained:', this.screenStream);

      // Replace video track in peer connection
      const videoTrack = this.screenStream.getVideoTracks()[0];
      if (videoTrack && this.peerConnection.getSenders) {
        const sender = this.peerConnection.getSenders().find(s => 
          s.track && s.track.kind === 'video'
        );
        if (sender) {
          await sender.replaceTrack(videoTrack);
          console.log('WebRTCService: Screen share video track replaced');
        }
      }

      // Replace audio track if screen audio is available
      const audioTrack = this.screenStream.getAudioTracks()[0];
      if (audioTrack && this.peerConnection.getSenders) {
        const sender = this.peerConnection.getSenders().find(s => 
          s.track && s.track.kind === 'audio'
        );
        if (sender) {
          await sender.replaceTrack(audioTrack);
          console.log('WebRTCService: Screen share audio track replaced');
        }
      }

      this.screenSharingActive = true;

      // Listen for screen share end - React Native WebRTC may not support event listeners
      // We'll handle this in the UI when user manually stops sharing

      return this.screenStream;
    } catch (error) {
      console.error('WebRTCService: Error starting screen share:', error);
      throw error;
    }
  }

  async stopScreenShare(): Promise<void> {
    if (!this.screenSharingActive || !this.screenStream) {
      return;
    }

    try {
      console.log('WebRTCService: Stopping screen share...');

      // Stop screen stream tracks
      this.screenStream.getTracks().forEach(track => {
        track.stop();
      });

      // Restore original camera/mic stream
      if (this.localStream && this.peerConnection && this.peerConnection.getSenders) {
        const videoTrack = this.localStream.getVideoTracks()[0];
        const audioTrack = this.localStream.getAudioTracks()[0];

        // Replace video track back to camera
        if (videoTrack) {
          const sender = this.peerConnection.getSenders().find(s => 
            s.track && s.track.kind === 'video'
          );
          if (sender) {
            await sender.replaceTrack(videoTrack);
            console.log('WebRTCService: Camera video track restored');
          }
        }

        // Replace audio track back to microphone
        if (audioTrack) {
          const sender = this.peerConnection.getSenders().find(s => 
            s.track && s.track.kind === 'audio'
          );
          if (sender) {
            await sender.replaceTrack(audioTrack);
            console.log('WebRTCService: Microphone audio track restored');
          }
        }
      }

      this.screenStream = null;
      this.screenSharingActive = false;
      
      console.log('WebRTCService: Screen share stopped successfully');
    } catch (error) {
      console.error('WebRTCService: Error stopping screen share:', error);
      throw error;
    }
  }

  endCall(): void {
    if (this.isEnding) {
      console.log('Call already ending, skipping...');
      return;
    }
    
    this.isEnding = true;
    console.log('Ending call...');
    
    try {
      // Stop screen sharing if active
      if (this.screenSharingActive && this.screenStream) {
        this.screenStream.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (error) {
            console.warn('Error stopping screen share track:', error);
          }
        });
        this.screenStream = null;
        this.screenSharingActive = false;
      }

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
      this.processingRemoteDescription = false;

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
