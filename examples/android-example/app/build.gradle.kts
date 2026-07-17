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

    val composeBom = platform("androidx.compose:compose-bom:2026.02.00")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.12.4")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
}
