plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.plugin.compose")
}

val canonicalFixture = layout.projectDirectory.file(
    "../../../protocol/fixtures/v0.1/complete-paywall.json",
)
val generatedCanonicalAssets = layout.buildDirectory.dir("generated/mosaic/canonical-assets")
val generateCanonicalPaywallAsset by tasks.registering(Copy::class) {
    from(canonicalFixture)
    into(generatedCanonicalAssets.map { it.dir("mosaic") })
    rename { "complete-paywall.json" }
}

android {
    namespace = "dev.mosaic.sdk"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.all {
            it.systemProperty(
                "mosaic.repositoryRoot",
                rootProject.file("../..").canonicalPath,
            )
        }
    }

    sourceSets.named("main") {
        // The directory is generated and ignored; the explicit preBuild edge keeps it current.
        assets.srcDir(generatedCanonicalAssets.get().asFile)
    }
}

tasks.named("preBuild") {
    dependsOn(generateCanonicalPaywallAsset)
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.02.00")
    implementation(composeBom)
    implementation("androidx.compose.runtime:runtime")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("com.google.code.gson:gson:2.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")

    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
