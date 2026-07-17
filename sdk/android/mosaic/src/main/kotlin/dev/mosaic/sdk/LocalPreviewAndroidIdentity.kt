package dev.mosaic.sdk

import android.content.Context
import android.os.Build

object MosaicAndroidPreviewIdentity {
    fun create(
        context: Context,
        clientId: String,
        displayName: String = "Android example preview",
    ): MosaicPreviewClientIdentity {
        val applicationContext = context.applicationContext
        val packageName = applicationContext.packageName
        val version = runCatching {
            applicationContext.packageManager.getPackageInfo(packageName, 0).versionName
        }.getOrNull().orEmpty().ifBlank { "0.1.0" }
        return MosaicPreviewClientIdentity(
            clientId = clientId,
            displayName = safeDisplayName(displayName, "Android preview"),
            renderer = MosaicPreviewSoftwareIdentity(
                id = "mosaic.android",
                version = MOSAIC_ANDROID_SDK_VERSION,
            ),
            application = MosaicPreviewApplicationIdentity(
                id = packageName.take(128),
                displayName = safeDisplayName(
                    applicationContext.applicationInfo.loadLabel(applicationContext.packageManager).toString(),
                    "Android application",
                ),
                version = safeSingleLine(version, 64, "0.1.0"),
            ),
            device = MosaicPreviewDeviceIdentity(
                displayName = safeDisplayName(Build.MODEL, "Android device"),
                systemName = "Android",
                systemVersion = safeSingleLine(Build.VERSION.RELEASE, 64, Build.VERSION.SDK_INT.toString()),
            ),
        )
    }

    private fun safeDisplayName(value: String, fallback: String): String =
        safeSingleLine(value, 80, fallback)

    private fun safeSingleLine(value: String, maximum: Int, fallback: String): String = value
        .replace('\r', ' ')
        .replace('\n', ' ')
        .take(maximum)
        .ifBlank { fallback }
}
