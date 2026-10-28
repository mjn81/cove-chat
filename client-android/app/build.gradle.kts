plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}


// Single source of truth is the root VERSION file (MAJOR.MINOR.PATCH[-pre]); versionCode is MAJOR*10000 + MINOR*100 + PATCH.
val cove: Pair<Int, String> = rootProject.projectDir.parentFile.resolve("VERSION").readText().trim().let { v ->
    val (major, minor, patch) = v.substringBefore("-").split(".").map { it.toInt() }
    (major * 10000 + minor * 100 + patch) to v
}

android {
    namespace = "com.cove.chat"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.cove.chat"
        minSdk = 26
        targetSdk = 35
        versionCode = cove.first
        versionName = cove.second

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    // Release signing comes from the environment (CI secrets). Without a keystore the release build falls
    // back to the debug key so beta APKs stay installable; the workflow logs which one was used.
    signingConfigs {
        create("release") {
            val keystore = System.getenv("COVE_KEYSTORE_FILE")
            if (!keystore.isNullOrBlank()) {
                storeFile = file(keystore)
                storePassword = System.getenv("COVE_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("COVE_KEY_ALIAS")
                keyPassword = System.getenv("COVE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (System.getenv("COVE_KEYSTORE_FILE").isNullOrBlank()) signingConfigs.getByName("debug") else signingConfigs.getByName("release")
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)

    // Jetpack Compose BOM & UI
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.navigation.compose)

    // Security & Encrypted Preferences
    implementation(libs.androidx.security.crypto)

    // Ktor REST & WebSockets
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.client.websockets)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.serialization.kotlinx.json)
    implementation(libs.ktor.network) // Raw UDP socket support for air-gapped mode

    // Serialization & Coroutines
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    // WebRTC SFU Client (Group Video, Voice, Screen share)
    implementation(libs.stream.webrtc)

    // Zstandard Compression (Matches Web Client WASM)
    // The Android AAR carries the per-ABI native libs; the plain JVM jar fails to load on devices.
    implementation("${libs.zstd.jni.get()}@aar")

    // Image & Avatar Loading
    implementation(libs.coil.compose)

    // Inline + fullscreen video message playback (hardware decoders, texture surface so it clips to rounded tiles)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.ui)

    debugImplementation(libs.androidx.compose.ui.tooling)
}
