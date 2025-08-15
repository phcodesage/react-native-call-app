import React from 'react';
import { Platform, View, StyleSheet } from 'react-native';

// Platform-specific imports
let RTCView: any = null;
let MediaStream: any = null;

if (Platform.OS !== 'web') {
  // Only import react-native-webrtc on native platforms
  try {
    const webrtc = require('react-native-webrtc');
    RTCView = webrtc.RTCView;
    MediaStream = webrtc.MediaStream;
  } catch (error) {
    console.warn('react-native-webrtc not available:', error);
  }
}

interface WebRTCViewProps {
  streamURL?: string;
  stream?: any; // MediaStream
  style?: any;
  objectFit?: 'contain' | 'cover';
  mirror?: boolean;
  zOrder?: number;
  placeholder?: React.ReactNode;
}

export const WebRTCView: React.FC<WebRTCViewProps> = ({
  streamURL,
  stream,
  style,
  objectFit = 'cover',
  mirror = false,
  zOrder = 0,
  placeholder
}) => {
  if (Platform.OS === 'web') {
    // Web implementation using HTML5 video
    return (
      <View style={[style, styles.webVideoContainer]}>
        {stream ? (
          <video
            ref={(video) => {
              if (video && stream) {
                video.srcObject = stream;
                video.play().catch(console.error);
              }
            }}
            style={{
              width: '100%',
              height: '100%',
              objectFit: objectFit,
              transform: mirror ? 'scaleX(-1)' : 'none',
              backgroundColor: '#000',
            }}
            autoPlay
            playsInline
            muted={mirror} // Mute local video to prevent feedback
          />
        ) : (
          placeholder || <View style={[style, { backgroundColor: '#000' }]} />
        )}
      </View>
    );
  }

  // Native implementation using react-native-webrtc
  if (RTCView && (streamURL || stream)) {
    const props: any = {
      style,
      objectFit,
      zOrder,
    };

    if (streamURL) {
      props.streamURL = streamURL;
    } else if (stream && stream.toURL) {
      props.streamURL = stream.toURL();
    }

    if (mirror) {
      props.mirror = true;
    }

    return React.createElement(RTCView, props);
  }

  // Fallback for when RTCView is not available
  return placeholder || <View style={[style, { backgroundColor: '#000' }]} />;
};

const styles = StyleSheet.create({
  webVideoContainer: {
    overflow: 'hidden',
  },
});

// Export MediaStream for compatibility
export { MediaStream };
