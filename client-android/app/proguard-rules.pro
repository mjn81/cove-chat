# WebRTC keep rules
-keep class org.webrtc.** { *; }

# Zstandard JNI keep rules
-keep class com.github.luben.zstd.** { *; }

# Serialization keep rules
-keepattributes *Annotation*,InnerClasses
-dontnote kotlinx.serialization.SerializationKt
-keepclassmembers class * {
    @kotlinx.serialization.Serializable mMethod(...);
}
