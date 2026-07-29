package dev.mosaic.sdk

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * The store is exercised through its `File` constructor so these run on the JVM.
 *
 * The behaviour under test is filesystem behaviour, not Android behaviour: an instrumented run
 * would prove the same isolation far more slowly, and the one thing only a device can prove — that
 * `noBackupFilesDir` is where the store lives — is fixed by the `Context` constructor rather than by
 * anything a test could vary.
 */
class CustomerEntitlementCacheTest {
    @get:Rule
    val folder = TemporaryFolder()

    private fun cache(): MosaicCustomerEntitlementCache = MosaicCustomerEntitlementCache(folder.root)

    /** Two identities never share a file, so clearing one cannot disturb the other. */
    @Test
    fun customersAreIsolatedByDirectory() {
        val store = cache()
        val first = MosaicCustomerEntitlementCache.bindingDigest("fixture-customer-0001")
        val second = MosaicCustomerEntitlementCache.bindingDigest("fixture-customer-0002")
        assertFalse(first == second)

        store.write(first, "{\"a\":1}")
        store.write(second, "{\"a\":2}")
        store.clear(first)

        assertNull(store.read(first))
        assertEquals("{\"a\":2}", store.read(second))
    }

    /** The Billing Customer identifier itself is never written to disk in the clear. */
    @Test
    fun customerIdentifierNeverAppearsOnDisk() {
        val store = cache()
        val digest = MosaicCustomerEntitlementCache.bindingDigest("customer-with-a-recognisable-id")
        store.write(digest, "{\"a\":1}")
        store.writePointer(digest)

        val allText = folder.root.walkTopDown().filter(File::isFile).joinToString("\n") { it.path + "\n" + it.readText() }
        assertFalse(allText.contains("customer-with-a-recognisable-id"))
    }

    /**
     * Signing out leaves nothing behind.
     *
     * "Unreachable but present" is not good enough: the file is a readable record of what somebody
     * paid for, on a device they may have handed to someone else.
     */
    @Test
    fun logoutRemovesEverySnapshotAndThePointer() {
        val store = cache()
        val digest = MosaicCustomerEntitlementCache.bindingDigest("fixture-customer-0001")
        store.write(digest, "{\"a\":1}")
        store.writePointer(digest)

        store.clearAll()

        assertNull(store.read(digest))
        assertNull(store.pointer())
        assertFalse(folder.root.exists())
    }

    /** An identity change keeps the new customer and removes every previous one. */
    @Test
    fun retainingOneIdentityRemovesThePrevious() {
        val store = cache()
        val previous = MosaicCustomerEntitlementCache.bindingDigest("fixture-customer-0001")
        val current = MosaicCustomerEntitlementCache.bindingDigest("fixture-customer-0002")
        store.write(previous, "{\"a\":1}")
        store.write(current, "{\"a\":2}")

        store.retainOnly(current)

        assertNull(store.read(previous))
        assertEquals("{\"a\":2}", store.read(current))
    }

    /** A write leaves exactly one file behind: no temporary file survives a completed write. */
    @Test
    fun atomicWriteLeavesNoTemporaryBehind() {
        val store = cache()
        val digest = MosaicCustomerEntitlementCache.bindingDigest("fixture-customer-0001")
        store.write(digest, "{\"a\":1}")
        store.write(digest, "{\"a\":2}")

        val files = File(folder.root, digest).listFiles().orEmpty()
        assertEquals(1, files.size)
        assertEquals("snapshot.json", files.single().name)
        assertEquals("{\"a\":2}", store.read(digest))
    }

    /** A foreign or hand-edited pointer is ignored rather than trusted. */
    @Test
    fun pointerRejectsAnUnknownFormat() {
        val store = cache()
        val digest = MosaicCustomerEntitlementCache.bindingDigest("fixture-customer-0001")
        store.writePointer(digest)
        assertEquals(digest, store.pointer())

        File(folder.root, "current.json").writeText("{\"cacheFormatVersion\":\"9\",\"bindingDigest\":\"$digest\"}")
        assertNull(store.pointer())

        File(folder.root, "current.json").writeText("{\"bindingDigest\":\"$digest\"}")
        assertNull(store.pointer())
    }

    /** A digest is the only admissible directory name; a caller cannot escape the namespace. */
    @Test
    fun onlyDigestNamesAreAccepted() {
        val store = cache()
        assertTrue(
            runCatching { store.write("../escape", "{}") }.exceptionOrNull() is IllegalArgumentException,
        )
    }
}
