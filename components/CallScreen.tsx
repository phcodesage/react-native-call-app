import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
    Alert,
    Dimensions,
    SafeAreaView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    useColorScheme,
    View,
} from 'react-native';
import { MediaStream, RTCView } from 'react-native-webrtc';

// RTCView props interface for proper typing
interface RTCViewProps {
  streamURL: string;
  style?: any;
  objectFit?: 'contain' | 'cover';
  mirror?: boolean;
  zOrder?: number;
}

const { width, height } = Dimensions.get('window');

interface CallScreenProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isConnected: boolean;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  callDuration: string;
  recipientName: string;
  onEndCall: () => void;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onSwitchCamera: () => void;
  onToggleSpeaker?: () => void;
}

export const CallScreen: React.FC<CallScreenProps> = ({
  localStream,
  remoteStream,
  isConnected,
  isAudioMuted,
  isVideoMuted,
  callDuration,
  recipientName,
  onEndCall,
  onToggleMute,
  onToggleVideo,
  onSwitchCamera,
  onToggleSpeaker,
}) => {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [isLocalVideoLarge, setIsLocalVideoLarge] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const hasVideo = (localStream?.getVideoTracks().length ?? 0) > 0 || (remoteStream?.getVideoTracks().length ?? 0) > 0;

  useEffect(() => {
    // Hide controls after 5 seconds of inactivity
    const resetControlsTimer = () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      setControlsVisible(true);
      controlsTimeoutRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 5000) as unknown as NodeJS.Timeout;
    };

    resetControlsTimer();

    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  const showControls = () => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, 5000) as unknown as NodeJS.Timeout;
  };

  const handleEndCall = () => {
    Alert.alert(
      'End Call',
      'Are you sure you want to end this call?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End Call', style: 'destructive', onPress: onEndCall },
      ]
    );
  };

  const renderVideoCall = () => (
    <View style={styles.videoContainer}>
      {/* Remote Video (Main) */}
      <TouchableOpacity
        style={styles.remoteVideoContainer as any}
        onPress={showControls}
        activeOpacity={1}
      >
        {remoteStream ? (
          React.createElement(RTCView as any, {
            streamURL: remoteStream.toURL(),
            style: styles.remoteVideo,
            objectFit: "cover",
            zOrder: 0,
          })
        ) : (
          <View style={[styles.remoteVideo as any, styles.videoPlaceholder as any]}>
            <View style={styles.avatarLarge as any}>
              <Text style={styles.avatarTextLarge as any}>
                {recipientName.charAt(0).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.waitingText as any}>
              {isConnected ? 'Camera is off' : 'Connecting...'}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Local Video (Picture-in-Picture) */}
      {localStream && !isVideoMuted && (
        <TouchableOpacity
          style={[
            styles.localVideoContainer as any,
            isLocalVideoLarge && (styles.localVideoLarge as any)
          ]}
          onPress={() => setIsLocalVideoLarge(!isLocalVideoLarge)}
        >
          {React.createElement(RTCView as any, {
            streamURL: localStream.toURL(),
            style: styles.localVideo,
            objectFit: "cover",
            mirror: true,
            zOrder: 1,
          })}
        </TouchableOpacity>
      )}
    </View>
  );

  const renderAudioCall = () => (
    <TouchableOpacity
      style={styles.audioContainer as any}
      onPress={showControls}
      activeOpacity={1}
    >
      <View style={styles.audioContent as any}>
        <View style={styles.avatarContainer as any}>
          <View style={styles.avatarLarge}>
            <Text style={styles.avatarTextLarge}>
              {recipientName.charAt(0).toUpperCase()}
            </Text>
          </View>
          {isConnected && (
            <View style={styles.audioIndicator as any}>
              <View style={[styles.audioWave as any, styles.audioWave1 as any]} />
              <View style={[styles.audioWave as any, styles.audioWave2 as any]} />
              <View style={[styles.audioWave as any, styles.audioWave3 as any]} />
            </View>
          )}
        </View>
        <Text style={styles.recipientName as any}>{recipientName}</Text>
        <Text style={styles.callStatus as any}>
          {isConnected ? 'Connected' : 'Connecting...'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#000' }]}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      
      {hasVideo ? renderVideoCall() : renderAudioCall()}

      {/* Call Info Header */}
      {controlsVisible && (
        <View style={styles.header as any}>
          <View style={styles.callInfo as any}>
            <Text style={styles.recipientNameHeader as any}>{recipientName}</Text>
            <Text style={styles.callDuration as any}>{callDuration}</Text>
          </View>
        </View>
      )}

      {/* Call Controls */}
      {controlsVisible && (
        <View style={styles.controls as any}>
          <View style={styles.controlRow as any}>
            {/* Mute Button */}
            <TouchableOpacity
              style={[
                styles.controlButton as any,
                isAudioMuted && (styles.controlButtonActive as any)
              ]}
              onPress={onToggleMute}
            >
              <Ionicons
                name={isAudioMuted ? 'mic-off' : 'mic'}
                size={24}
                color={isAudioMuted ? '#ef4444' : '#ffffff'}
              />
            </TouchableOpacity>

            {/* Video Button (only for video calls) */}
            {hasVideo && (
              <TouchableOpacity
                style={[
                  styles.controlButton as any,
                  isVideoMuted && (styles.controlButtonActive as any)
                ]}
                onPress={onToggleVideo}
              >
                <Ionicons
                  name={isVideoMuted ? 'videocam-off' : 'videocam'}
                  size={24}
                  color={isVideoMuted ? '#ef4444' : '#ffffff'}
                />
              </TouchableOpacity>
            )}

            {/* Switch Camera Button (only for video calls) */}
            {hasVideo && !isVideoMuted && (
              <TouchableOpacity
                style={styles.controlButton}
                onPress={onSwitchCamera}
              >
                <Ionicons name="camera-reverse" size={24} color="#ffffff" />
              </TouchableOpacity>
            )}

            {/* Speaker Button (for audio calls) */}
            {!hasVideo && onToggleSpeaker && (
              <TouchableOpacity
                style={styles.controlButton}
                onPress={onToggleSpeaker}
              >
                <Ionicons name="volume-high" size={24} color="#ffffff" />
              </TouchableOpacity>
            )}
          </View>

          {/* End Call Button */}
          <TouchableOpacity
            style={styles.endCallButton as any}
            onPress={handleEndCall}
          >
            <Ionicons name="call" size={28} color="#ffffff" />
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  videoContainer: {
    flex: 1,
    position: 'relative',
  },
  remoteVideoContainer: {
    flex: 1,
  },
  remoteVideo: {
    flex: 1,
    backgroundColor: '#000',
  },
  localVideoContainer: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 120,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#ffffff',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  localVideoLarge: {
    top: 60,
    left: 20,
    right: 20,
    bottom: 140,
    width: 'auto',
    height: 'auto',
  },
  localVideo: {
    flex: 1,
  },
  videoPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  audioContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1f2937',
  },
  audioContent: {
    alignItems: 'center',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 32,
  },
  avatarLarge: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#420796',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarTextLarge: {
    fontSize: 64,
    fontWeight: '600',
    color: '#ffffff',
  },
  audioIndicator: {
    position: 'absolute',
    bottom: -10,
    left: '50%',
    marginLeft: -30,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  audioWave: {
    width: 4,
    backgroundColor: '#10b981',
    borderRadius: 2,
  },
  audioWave1: {
    height: 16,
    animationDelay: '0ms',
  },
  audioWave2: {
    height: 24,
    animationDelay: '150ms',
  },
  audioWave3: {
    height: 20,
    animationDelay: '300ms',
  },
  recipientName: {
    fontSize: 28,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 8,
    textAlign: 'center',
  },
  callStatus: {
    fontSize: 16,
    color: '#9ca3af',
    textAlign: 'center',
  },
  waitingText: {
    fontSize: 18,
    color: '#9ca3af',
    marginTop: 16,
    textAlign: 'center',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  callInfo: {
    alignItems: 'center',
  },
  recipientNameHeader: {
    fontSize: 20,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  callDuration: {
    fontSize: 14,
    color: '#e5e7eb',
  },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 40,
    paddingBottom: 50,
    paddingTop: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    alignItems: 'center',
  },
  controlRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
    gap: 24,
  },
  controlButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlButtonActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.8)',
  },
  endCallButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ rotate: '135deg' }],
  },
});
