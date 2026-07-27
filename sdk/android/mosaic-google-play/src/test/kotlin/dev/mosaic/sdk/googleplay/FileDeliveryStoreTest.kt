package dev.mosaic.sdk.googleplay

import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Runnable
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class FileDeliveryStoreTest {
    @get:Rule val folder = TemporaryFolder()

    /**
     * Guards the Phase 8 fix for main-thread `SharedPreferences.commit()`: every read and write
     * must be dispatched to the injected I/O dispatcher, never executed on the calling thread.
     * Removing `withContext(io)` drops the dispatch count to zero and fails here.
     */
    @Test
    fun `every delivery marker read and write is dispatched to the injected io dispatcher`() = runBlocking {
        val dispatches = AtomicInteger()
        val store = store(CountingDispatcher(dispatches))

        store.recordPending(DIGEST)
        val beforeFinalization = store.isFinalized(DIGEST)
        store.recordAccepted(DIGEST)
        store.recordFinalized(DIGEST)

        assertFalse(beforeFinalization)
        assertTrue(store.isFinalized(DIGEST))
        // Three writes read then persist, plus two standalone reads.
        assertEquals(8, dispatches.get())
    }

    /**
     * The legacy store was unbounded, so a long-lived install grew its delivery record without
     * limit. Eviction must remove the least recently written marker and must never evict the marker
     * just written, which would make a finalized purchase look undelivered immediately.
     */
    @Test
    fun `delivery markers are bounded and evict the least recently written digest`() = runBlocking {
        val store = store(Dispatchers.Unconfined)
        val digests = (0 until 300).map { digest(it) }

        digests.forEach { store.recordFinalized(it) }

        assertFalse(store.isFinalized(digests.first()))
        assertFalse(store.isFinalized(digests[43]))
        assertTrue(store.isFinalized(digests[44]))
        assertTrue(store.isFinalized(digests.last()))
        assertEquals(256, folder.root.resolve(RECORD).readLines().filter(String::isNotEmpty).size)
    }

    /**
     * A restored backup or a corrupted record must not be interpreted as a finalized delivery,
     * because that would grant Entitlements for a purchase this device never delivered.
     */
    @Test
    fun `a malformed delivery record is ignored rather than trusted`() = runBlocking {
        val record = folder.root.resolve(RECORD)
        record.parentFile?.mkdirs()
        record.writeText("finalized\tnot-a-digest\nnonsense\n")

        assertFalse(store(Dispatchers.Unconfined).isFinalized("not-a-digest"))
    }

    private fun store(io: CoroutineDispatcher) = FileDeliveryStore(folder.root.resolve(RECORD), io)

    private fun digest(index: Int) = "%064x".format(index)

    private class CountingDispatcher(private val dispatches: AtomicInteger) : CoroutineDispatcher() {
        override fun dispatch(context: CoroutineContext, block: Runnable) {
            dispatches.incrementAndGet()
            block.run()
        }
    }

    private companion object {
        const val RECORD = "markers.txt"
        val DIGEST = "%064x".format(7)
    }
}
