package dev.mosaic.sdk

import android.content.Context
import android.os.Build

object MosaicAndroidPreviewIdentity {
    /**
     * Sent when the host package reports no `versionName`.
     *
     * The Local Preview schema requires a numeric version, so absence cannot be sent as absence
     * here. The value is therefore one no build produces and whose build metadata says why it is
     * there, rather than a plausible number Studio would display as the app's real version.
     */
    private const val UNREPORTED_APPLICATION_VERSION = "0.0.0+unreported"

    fun create(
        context: Context,
        clientId: String,
        displayName: String = "Android example preview",
    ): MosaicPreviewClientIdentity {
        val applicationContext = context.applicationContext
        val packageName = applicationContext.packageName
        val version = runCatching {
            applicationContext.packageManager.getPackageInfo(packageName, 0).versionName
        }.getOrNull().orEmpty().ifBlank { UNREPORTED_APPLICATION_VERSION }
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
                version = safeSingleLine(version, 64, UNREPORTED_APPLICATION_VERSION),
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
