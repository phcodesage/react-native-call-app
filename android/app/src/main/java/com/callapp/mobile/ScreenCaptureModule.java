package com.callapp.mobile;

import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.util.Log;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import org.webrtc.ScreenCapturerAndroid;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoCapturer;
import org.webrtc.VideoSource;
import org.webrtc.VideoTrack;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.EglBase;

public class ScreenCaptureModule extends ReactContextBaseJavaModule {
    private static final String TAG = "ScreenCaptureModule";
    private static final int SCREEN_CAPTURE_REQUEST_CODE = 1001;
    
    private MediaProjectionManager mediaProjectionManager;
    private MediaProjection mediaProjection;
    private VideoCapturer screenCapturer;
    private VideoSource videoSource;
    private VideoTrack screenVideoTrack;
    private Promise screenCapturePromise;
    private PeerConnectionFactory peerConnectionFactory;
    private EglBase rootEglBase;
    private SurfaceTextureHelper surfaceTextureHelper;

    private final ActivityEventListener activityEventListener = new BaseActivityEventListener() {
        @Override
        public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
            if (requestCode == SCREEN_CAPTURE_REQUEST_CODE) {
                if (resultCode == Activity.RESULT_OK && data != null) {
                    handleScreenCapturePermissionResult(resultCode, data);
                } else {
                    if (screenCapturePromise != null) {
                        screenCapturePromise.reject("PERMISSION_DENIED", "Screen capture permission denied");
                        screenCapturePromise = null;
                    }
                }
            }
        }
    };

    public ScreenCaptureModule(ReactApplicationContext reactContext) {
        super(reactContext);
        reactContext.addActivityEventListener(activityEventListener);
        mediaProjectionManager = (MediaProjectionManager) reactContext.getSystemService(reactContext.MEDIA_PROJECTION_SERVICE);
        
        // Initialize WebRTC components
        initializeWebRTC();
    }

    @Override
    public String getName() {
        return "ScreenCaptureModule";
    }

    private void initializeWebRTC() {
        try {
            // Initialize EGL context
            rootEglBase = EglBase.create();
            
            // Initialize PeerConnectionFactory (should ideally be shared with main WebRTC service)
            PeerConnectionFactory.InitializationOptions initOptions = PeerConnectionFactory.InitializationOptions.builder(getReactApplicationContext())
                .setEnableInternalTracer(false)
                .createInitializationOptions();
            PeerConnectionFactory.initialize(initOptions);

            peerConnectionFactory = PeerConnectionFactory.builder()
                .setVideoEncoderFactory(new org.webrtc.DefaultVideoEncoderFactory(rootEglBase.getEglBaseContext(), true, true))
                .setVideoDecoderFactory(new org.webrtc.DefaultVideoDecoderFactory(rootEglBase.getEglBaseContext()))
                .createPeerConnectionFactory();

            Log.d(TAG, "WebRTC components initialized successfully");
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize WebRTC components", e);
        }
    }

    @ReactMethod
    public void requestScreenCapturePermission(Promise promise) {
        try {
            screenCapturePromise = promise;
            Activity currentActivity = getCurrentActivity();
            
            if (currentActivity == null) {
                promise.reject("NO_ACTIVITY", "No current activity available");
                return;
            }

            Intent captureIntent = mediaProjectionManager.createScreenCaptureIntent();
            currentActivity.startActivityForResult(captureIntent, SCREEN_CAPTURE_REQUEST_CODE);
            
        } catch (Exception e) {
            Log.e(TAG, "Error requesting screen capture permission", e);
            promise.reject("REQUEST_FAILED", "Failed to request screen capture permission: " + e.getMessage());
        }
    }

    private void handleScreenCapturePermissionResult(int resultCode, Intent data) {
        try {
            mediaProjection = mediaProjectionManager.getMediaProjection(resultCode, data);
            
            if (mediaProjection != null) {
                startScreenCapture(resultCode, data);
                if (screenCapturePromise != null) {
                    screenCapturePromise.resolve("Screen capture started successfully");
                    screenCapturePromise = null;
                }
            } else {
                if (screenCapturePromise != null) {
                    screenCapturePromise.reject("PROJECTION_FAILED", "Failed to create media projection");
                    screenCapturePromise = null;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error handling screen capture permission result", e);
            if (screenCapturePromise != null) {
                screenCapturePromise.reject("HANDLING_FAILED", "Failed to handle permission result: " + e.getMessage());
                screenCapturePromise = null;
            }
        }
    }

    private void startScreenCapture(int resultCode, Intent data) {
        try {
            if (peerConnectionFactory == null) {
                throw new RuntimeException("PeerConnectionFactory not initialized");
            }

            // Create video source first
            videoSource = peerConnectionFactory.createVideoSource(false);
            surfaceTextureHelper = SurfaceTextureHelper.create("ScreenCaptureThread", rootEglBase.getEglBaseContext());

            // Create screen capturer, passing the capturer observer from the video source
            screenCapturer = new ScreenCapturerAndroid(
                data,
                new MediaProjection.Callback() {
                    @Override
                    public void onStop() {
                        Log.d(TAG, "MediaProjection stopped");
                    }
                }
            );
            
            screenCapturer.initialize(surfaceTextureHelper, getReactApplicationContext(), videoSource.getCapturerObserver());
            screenCapturer.startCapture(1920, 1080, 30);

            screenVideoTrack = peerConnectionFactory.createVideoTrack("ScreenVideoTrack", videoSource);
            
            Log.d(TAG, "Screen capture started successfully");
            
        } catch (Exception e) {
            Log.e(TAG, "Error starting screen capture", e);
            throw e;
        }
    }

    @ReactMethod
    public void stopScreenCapture(Promise promise) {
        try {
            if (screenCapturer != null) {
                screenCapturer.stopCapture();
                screenCapturer.dispose();
                screenCapturer = null;
            }

            if (videoSource != null) {
                videoSource.dispose();
                videoSource = null;
            }

            if (screenVideoTrack != null) {
                screenVideoTrack.dispose();
                screenVideoTrack = null;
            }

            if (surfaceTextureHelper != null) {
                surfaceTextureHelper.dispose();
                surfaceTextureHelper = null;
            }

            if (mediaProjection != null) {
                mediaProjection.stop();
                mediaProjection = null;
            }

            Log.d(TAG, "Screen capture stopped successfully");
            promise.resolve("Screen capture stopped");
            
        } catch (Exception e) {
            Log.e(TAG, "Error stopping screen capture", e);
            promise.reject("STOP_FAILED", "Failed to stop screen capture: " + e.getMessage());
        }
    }

    @ReactMethod
    public void getScreenVideoTrack(Promise promise) {
        try {
            if (screenVideoTrack != null) {
                // Return track ID that can be used by WebRTC service
                promise.resolve(screenVideoTrack.id());
            } else {
                promise.reject("NO_TRACK", "No screen video track available");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error getting screen video track", e);
            promise.reject("GET_TRACK_FAILED", "Failed to get screen video track: " + e.getMessage());
        }
    }

    // Method to get the actual VideoTrack object (for internal use by WebRTC service)
    public VideoTrack getScreenVideoTrackObject() {
        return screenVideoTrack;
    }

    @Override
    public void onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy();
        
        // Cleanup resources
        if (screenCapturer != null) {
            screenCapturer.dispose();
        }
        if (videoSource != null) {
            videoSource.dispose();
        }
        if (screenVideoTrack != null) {
            screenVideoTrack.dispose();
        }
        if (surfaceTextureHelper != null) {
            surfaceTextureHelper.dispose();
        }
        if (mediaProjection != null) {
            mediaProjection.stop();
        }
        if (rootEglBase != null) {
            rootEglBase.release();
        }
    }
}
