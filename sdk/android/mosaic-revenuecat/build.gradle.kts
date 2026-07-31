import org.gradle.api.publish.maven.MavenPublication

plugins {
    id("com.android.library")
    id("maven-publish")
}

group = "dev.mosaic.sdk"
version = "0.1.0-dev.7"

android {
    namespace = "dev.mosaic.sdk.revenuecat"
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
                artifactId = "mosaic-revenuecat"
                pom {
                    name.set("Mosaic RevenueCat")
                    description.set("Optional RevenueCat provider for the Mosaic Android SDK.")
                }
            }
        }
    }
}

dependencies {
    api(project(":mosaic"))
    implementation("com.revenuecat.purchases:purchases:10.15.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
}
