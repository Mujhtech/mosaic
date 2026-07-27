plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "dev.mosaic.example"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.mosaic.example"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1"
    }

    buildTypes {
        // R8 runs permanently in the example release build so a Mosaic change that would need
        // consumer keep rules fails `:app:assembleRelease` instead of silently corrupting a
        // released host application's persisted Mosaic records.
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(project(":mosaic"))
    implementation(project(":mosaic-revenuecat"))
    implementation(project(":mosaic-google-play"))
    implementation("com.revenuecat.purchases:purchases:10.15.0")

    val composeBom = platform("androidx.compose:compose-bom:2026.02.00")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.12.4")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
}
