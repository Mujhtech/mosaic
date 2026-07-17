package dev.mosaic.sdk

import com.google.gson.JsonArray
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class LocalPreviewCodecTest {
    @Test
    fun `canonical session flow decodes and round trips every message type`() {
        val flow = canonicalPreviewFlow()
        val decoded = flow.map { source -> MosaicLocalPreviewCodec.decode(source.toString()) }

        assertEquals(MosaicPreviewMessageType.entries.toSet(), decoded.map { it.type }.toSet())
        decoded.zip(flow).forEach { (message, source) ->
            val encoded = JsonParser.parseString(MosaicLocalPreviewCodec.encode(message))
            assertEquals(source, encoded)
        }
    }

    @Test
    fun `preview locale accepts the canonical seven character locale form`() {
        val source = canonicalPreviewFlow()[3].asJsonObject.deepCopy()
        source.getAsJsonObject("payload").getAsJsonObject("preview")
            .addProperty("locale", "abc-123")

        val message = MosaicLocalPreviewCodec.decode(source.toString())

        val draft = message.payload as MosaicPreviewDraftUpdatedPayload
        assertEquals("abc-123", draft.preview.locale)
    }

    @Test
    fun `unknown envelope and payload properties are rejected`() {
        val envelope = canonicalPreviewFlow()[0].asJsonObject.deepCopy().apply {
            addProperty("token", "must-not-be-accepted")
        }
        val payload = canonicalPreviewFlow()[14].asJsonObject.deepCopy().apply {
            getAsJsonObject("payload").addProperty("extra", true)
        }

        assertThrows(MosaicPreviewCodecException::class.java) {
            MosaicLocalPreviewCodec.decode(envelope.toString())
        }
        assertThrows(MosaicPreviewCodecException::class.java) {
            MosaicLocalPreviewCodec.decode(payload.toString())
        }
    }

    @Test
    fun `frames above two MiB fail before parsing`() {
        val oversized = "{" + " ".repeat(MOSAIC_LOCAL_PREVIEW_MAX_FRAME_BYTES) + "}"

        val error = assertThrows(MosaicPreviewCodecException::class.java) {
            MosaicLocalPreviewCodec.decode(oversized)
        }

        assertTrue(error.message.orEmpty().contains("2 MiB"))
    }

    private fun canonicalPreviewFlow(): JsonArray = JsonParser.parseString(
        Files.readAllBytes(
            repositoryFile("protocol/fixtures/local-preview/v0.1/session-flow.messages.json"),
        ).toString(Charsets.UTF_8),
    ).asJsonArray
}
