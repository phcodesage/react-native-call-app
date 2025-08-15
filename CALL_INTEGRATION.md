# Call Integration Guide

This document outlines the call functionality integration in your React Native app.

## Overview

The call system includes:
- **Call Setup Modal**: Device selection (camera, microphone, speaker)
- **Call Screen**: Full-screen call interface with controls
- **Incoming Call Modal**: Accept/decline incoming calls
- **WebRTC Service**: Handles peer-to-peer communication

## Components

### 1. CallSetupModal (`components/CallSetupModal.tsx`)
- Shows before starting a call
- Allows selection of audio/video devices
- Provides camera preview for video calls
- Shows microphone level indicator for audio calls

### 2. CallScreen (`components/CallScreen.tsx`)
- Full-screen call interface
- Video/audio call support
- Call controls (mute, video toggle, camera switch)
- Call timer and status indicators

### 3. IncomingCallModal (`components/IncomingCallModal.tsx`)
- Displays when receiving an incoming call
- Shows caller information
- Accept/decline buttons with animations
- Vibration and visual feedback

### 4. WebRTCService (`services/WebRTCService.ts`)
- Manages WebRTC peer connections
- Handles media streams
- Device switching functionality
- Call state management

## Integration Points

### Chat Screen Integration
The call functionality is integrated into the chat screen (`app/chat/[roomId].tsx`):

1. **Call Buttons**: Added to the header (audio/video call buttons)
2. **Socket Handling**: WebRTC signaling through existing socket connection
3. **State Management**: Call-related state variables
4. **Modal Management**: Shows appropriate modals based on call state

### Socket Events
The following socket events are used for call signaling:

```typescript
// Outgoing signals
socket.emit('signal', {
  room: roomId,
  signal: { type: 'offer', sdp: offer.sdp, callType },
  from: username
});

// Incoming signals
socket.on('signal', (data) => {
  // Handle offer, answer, ice-candidate, call-declined, call-ended
});
```

## Usage

### Starting a Call
1. Click audio/video button in chat header
2. Call setup modal appears
3. Select devices (camera, microphone, speaker)
4. Click "Start Call"
5. Call screen appears

### Receiving a Call
1. Incoming call modal appears
2. Shows caller name and call type
3. Accept or decline the call
4. If accepted, call screen appears

### During a Call
- **Mute/Unmute**: Toggle microphone
- **Video On/Off**: Toggle camera
- **Switch Camera**: Front/back camera toggle
- **End Call**: Terminate the call

## Device Selection

### Audio Devices
- **Microphone**: Input audio device selection
- **Speaker**: Output audio device selection
- **Level Indicator**: Shows microphone input level

### Video Devices
- **Camera**: Front/back camera selection
- **Preview**: Real-time camera preview
- **Resolution**: Configurable video quality

## WebRTC Configuration

### ICE Servers
Default configuration uses Google's STUN server:
```typescript
const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' }
];
```

### Media Constraints
- **Audio**: Stereo, 48kHz, noise suppression disabled
- **Video**: 1280x720, 30fps (ideal settings)

## Permissions

The app requires the following permissions:
- **Camera**: For video calls
- **Microphone**: For audio/video calls
- **Network**: For peer-to-peer communication

## Error Handling

- **Permission Denied**: Shows permission request dialog
- **Device Not Found**: Falls back to default devices
- **Connection Failed**: Shows error message and ends call
- **Network Issues**: Automatic reconnection attempts

## Customization

### Styling
All components use the app's existing color scheme and styling patterns.

### Audio Quality
Stereo audio is enabled by default with SDP manipulation:
```typescript
sdp = enableStereoInSDP(sdp);
```

### Video Quality
Video constraints can be adjusted in `WebRTCService.ts`:
```typescript
video: {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 }
}
```

## Backend Requirements

Your backend should handle these socket events:
- `signal`: WebRTC signaling (offer, answer, ice-candidate)
- `join`: Room joining for call setup
- `leave`: Room leaving when call ends

## Testing

1. **Audio Calls**: Test with microphone mute/unmute
2. **Video Calls**: Test camera on/off, front/back switch
3. **Device Switching**: Test different audio/video devices
4. **Network Conditions**: Test on different network qualities
5. **Permissions**: Test permission grant/deny scenarios

## Troubleshooting

### Common Issues
1. **No Audio/Video**: Check device permissions
2. **Connection Failed**: Verify STUN/TURN server configuration
3. **Device Not Found**: Ensure devices are available and not in use
4. **Echo/Feedback**: Enable echo cancellation in audio constraints

### Debug Logs
Enable WebRTC logging for debugging:
```typescript
console.log('WebRTC state:', peerConnection.connectionState);
console.log('ICE state:', peerConnection.iceConnectionState);
```
