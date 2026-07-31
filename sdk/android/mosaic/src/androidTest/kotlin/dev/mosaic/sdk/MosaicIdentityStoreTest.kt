package dev.mosaic.sdk

import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MosaicIdentityStoreTest {
    @Test
    fun identityPersistsAndResetSemanticsKeepOrRotateInstallationKey() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val namespace = "instrumentation-${UUID.randomUUID()}"
        val firstStore = MosaicIdentityStore(context, namespace)
        val anonymous = firstStore.current()
        val identified = firstStore.identify("user_123", mapOf("student" to MosaicTypedValue.BooleanValue(true)))
        assertTrue(identified.alias != null)

        val reconstructed = MosaicIdentityStore(context, namespace)
        assertEquals("user_123", reconstructed.current().userId)
        val resetUser = reconstructed.resetUser()
        assertEquals(anonymous.installationId, resetUser.installationId)
        assertNull(resetUser.userId)
        assertNull(resetUser.alias)
        assertTrue(resetUser.attributes.isEmpty())

        val resetInstallation = reconstructed.resetInstallation()
        assertNotEquals(anonymous.installationId, resetInstallation.installationId)
        assertNull(resetInstallation.userId)
    }

    private fun assertTrue(value: Boolean) = org.junit.Assert.assertTrue(value)
}
