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

        // In-app self-update (check + download + system installer). A Play-store flavour must set this to false:
        // the store updates the app and sideload installs are not allowed there.
        buildConfigField("boolean", "SELF_UPDATE", "true")

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
            // R8 shrinks and optimises the ~17 MB of unminified dex and drops unused resources; see proguard-rules.pro.
            isMinifyEnabled = true
            isShrinkResources = true
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
        buildConfig = true
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

    // Opus codec for the encrypted UDP call path (air-gapped servers)
    implementation(libs.concentus)

    // Zstandard Compression (Matches Web Client WASM)
    // The Android AAR carries the per-ABI native libs; the plain JVM jar fails to load on devices.
    implementation("${libs.zstd.jni.get()}@aar")

    // Image & Avatar Loading
    implementation(libs.coil.compose)

    // Inline + fullscreen video message playback (hardware decoders, texture surface so it clips to rounded tiles)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.ui)

    // In-app camera for video messages (replaces launching the system recorder)
    implementation(libs.camerax.core)
    implementation(libs.camerax.camera2)
    implementation(libs.camerax.lifecycle)
    implementation(libs.camerax.video)
    implementation(libs.camerax.view)

    // JVM unit tests for pure logic (voice trim maths, ...)
    testImplementation("junit:junit:4.13.2")

    debugImplementation(libs.androidx.compose.ui.tooling)
}
