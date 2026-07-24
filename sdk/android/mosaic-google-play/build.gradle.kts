import org.gradle.api.publish.maven.MavenPublication

plugins {
    id("com.android.library")
    id("maven-publish")
}

group = "dev.mosaic.sdk"
version = "0.1.0-dev.6"

android {
    namespace = "dev.mosaic.sdk.googleplay"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    publishing {
        singleVariant("release") {
            withSourcesJar()
        }
    }
}

afterEvaluate {
    publishing {
        publications {
            register<MavenPublication>("release") {
                from(components["release"])
                artifactId = "mosaic-google-play"
                pom {
                    name.set("Mosaic Google Play Billing")
                    description.set("Optional Google Play Billing provider for the Mosaic Android SDK.")
                }
            }
        }
    }
}

dependencies {
    api(project(":mosaic"))
    implementation("com.android.billingclient:billing-ktx:9.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
}
