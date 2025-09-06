# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Comprehensive WebRTC rules to prevent crashes in release builds
-keep class org.webrtc.** { *; }
-keep class com.oney.WebRTCModule.** { *; }
-keep interface org.webrtc.** { *; }
-keepclassmembers class org.webrtc.** {
    *;
}
-keepattributes Signature,RuntimeVisibleAnnotations,AnnotationDefault
-dontwarn org.webrtc.**
-dontwarn com.oney.WebRTCModule.**

# React Native WebRTC specific
-keep class io.wazo.callkeep.** { *; }
-keep class co.apptailor.googlesignin.** { *; }

# Media streaming classes
-keep class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}

# Prevent obfuscation of native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep enums
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Serialization
-keep class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# React Native core
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }

# Expo modules
-keep class expo.modules.** { *; }
-keep class org.unimodules.** { *; }

# Socket.io client
-keep class io.socket.** { *; }
-dontwarn io.socket.**

# AsyncStorage
-keep class com.reactnativecommunity.asyncstorage.** { *; }

# React Native Permissions
-keep class com.zoontek.rnpermissions.** { *; }

# Notifications
-keep class expo.modules.notifications.** { *; }
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# Keep JavaScript interface for WebView bridge
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Add any project specific keep options here:
