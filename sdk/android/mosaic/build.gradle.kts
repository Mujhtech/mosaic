import org.gradle.api.publish.maven.MavenPublication

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.plugin.compose")
    id("maven-publish")
}

group = "dev.mosaic.sdk"
version = "0.1.0-dev.7"

val canonicalFixture = layout.projectDirectory.file(
    "../../../protocol/fixtures/v0.4/complete-paywall.json",
)
val generatedCanonicalAssets = layout.buildDirectory.dir("generated/mosaic/canonical-assets")
// The two-Screen round trip. A sheet is explicitly not a screen entry, and the complete paywall
// declares exactly one Screen, so screen-to-screen re-entry is only reachable through this fixture.
val protocolRoundTripFixture = layout.projectDirectory.file(
    "../../../protocol/fixtures/v0.4/screen-round-trip.json",
)
val generatedProtocolTestAssets = layout.buildDirectory.dir(
    "generated/mosaic/protocol-test-assets",
)

// A Gradle `Copy` whose source does not exist succeeds and produces nothing, so a renamed or
// deleted canonical fixture would ship a library with no bundled fallback and no build failure.
// `from` on a missing path is what makes that silent, so the path is checked at configuration time.
check(canonicalFixture.asFile.isFile) {
    "The canonical Paywall Protocol fixture is missing at ${canonicalFixture.asFile.path}."
}
check(protocolRoundTripFixture.asFile.isFile) {
    "The canonical round-trip fixture is missing at ${protocolRoundTripFixture.asFile.path}."
}

val generateCanonicalPaywallAsset by tasks.registering(Copy::class) {
    from(canonicalFixture)
    into(generatedCanonicalAssets.map { it.dir("mosaic") })
    rename { "complete-paywall.json" }
}
// Both fixtures keep their canonical names, so no rename is applied: a rename here would apply to
// every source and silently collapse the two onto one asset.
val generateProtocolTestAsset by tasks.registering(Copy::class) {
    from(canonicalFixture)
    from(protocolRoundTripFixture)
    into(generatedProtocolTestAssets.map { it.dir("mosaic/v0.4") })
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

    publishing {
        singleVariant("release") {
            withSourcesJar()
        }
    }

    sourceSets.named("main") {
        // The directory is generated and ignored; the explicit preBuild edge keeps it current.
        assets.srcDir(generatedCanonicalAssets.get().asFile)
    }
    sourceSets.named("androidTest") {
        assets.srcDir(generatedProtocolTestAssets.get().asFile)
    }
}

afterEvaluate {
    publishing {
        publications {
            register<MavenPublication>("release") {
                from(components["release"])
                artifactId = "mosaic"
                pom {
                    name.set("Mosaic Android SDK")
                    description.set("Provider-neutral Mosaic protocol decoding and Jetpack Compose rendering.")
                }
            }
        }
    }
}

tasks.named("preBuild") {
    dependsOn(generateCanonicalPaywallAsset)
    dependsOn(generateProtocolTestAsset)
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.02.00")
    implementation(composeBom)
    implementation("androidx.compose.runtime:runtime")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("com.google.code.gson:gson:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
    implementation("io.coil-kt:coil-compose:2.4.0")
    implementation("androidx.media3:media3-exoplayer:1.8.0")
    implementation("androidx.media3:media3-ui:1.8.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")

    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
