pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "mosaic-android-example"
include(":app", ":mosaic", ":mosaic-revenuecat")
project(":mosaic").projectDir = file("../../sdk/android/mosaic")
project(":mosaic-revenuecat").projectDir = file("../../sdk/android/mosaic-revenuecat")
