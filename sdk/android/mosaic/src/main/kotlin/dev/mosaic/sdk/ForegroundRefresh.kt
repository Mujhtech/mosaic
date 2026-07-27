package dev.mosaic.sdk

import android.app.Activity
import android.app.Application
import android.os.Bundle
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** Coalesces one best-effort refresh when the host process returns to the foreground. */
internal object MosaicForegroundRefreshRegistry {
    private val lifecycles = ConcurrentHashMap<String, Lifecycle>()

    fun register(application: Application, namespace: String, client: MosaicHostedConfigurationClient) {
        lifecycles.compute(namespace) { _, current ->
            (current ?: Lifecycle(application)).also { it.client = WeakReference(client) }
        }
    }

    private class Lifecycle(private val application: Application) : Application.ActivityLifecycleCallbacks {
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))
        @Volatile var client = WeakReference<MosaicHostedConfigurationClient>(null)
        private var started = 0

        init { application.registerActivityLifecycleCallbacks(this) }
        override fun onActivityStarted(activity: Activity) {
            started += 1
            if (started == 1) client.get()?.let { current -> scope.launch { runCatching { current.refresh() } } }
        }
        override fun onActivityStopped(activity: Activity) { started = (started - 1).coerceAtLeast(0) }
        override fun onActivityCreated(activity: Activity, state: Bundle?) = Unit
        override fun onActivityResumed(activity: Activity) = Unit
        override fun onActivityPaused(activity: Activity) = Unit
        override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) = Unit
        override fun onActivityDestroyed(activity: Activity) = Unit
    }
}
