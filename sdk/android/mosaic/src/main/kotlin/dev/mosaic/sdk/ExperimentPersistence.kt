package dev.mosaic.sdk

import android.content.Context
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

data class MosaicExperimentAssignmentRecord(
    val projectId: String,
    val environmentId: String,
    val experimentId: String,
    val experimentVersionId: String,
    val variantId: String,
    val allocationVersion: String,
    val assignmentKeyType: String,
    val subjectDigest: String,
    val bucket: Int,
    val algorithm: String,
    val assignedAtEpochMillis: Long,
    val groupId: String?,
    val groupVersionId: String?,
    val groupBucket: Int?,
    val qaOverride: Boolean,
    val exposed: Boolean,
    val lastUpdatedAtEpochMillis: Long,
)

/**
 * Assignment records use an explicit Gson tree codec rather than reflective binding, so a minified
 * release build cannot rename or strip persisted field names. Every field, including `exposed`, is
 * written and read by literal wire name; a record with unknown or missing fields is rejected rather
 * than silently reconstructed with defaults, which would resurface an already-counted exposure.
 */
internal object MosaicExperimentAssignmentRecordCodec {
    private val acceptedKeys = setOf(
        "projectId", "environmentId", "experimentId", "experimentVersionId", "variantId",
        "allocationVersion", "assignmentKeyType", "subjectDigest", "bucket", "algorithm",
        "assignedAtEpochMillis", "groupId", "groupVersionId", "groupBucket", "qaOverride",
        "exposed", "lastUpdatedAtEpochMillis",
    )
    private val requiredKeys = acceptedKeys - setOf("groupId", "groupVersionId", "groupBucket")

    fun encode(records: List<MosaicExperimentAssignmentRecord>): String =
        JsonArray().apply {
            records.forEach { record ->
                add(
                    JsonObject().apply {
                        addProperty("projectId", record.projectId)
                        addProperty("environmentId", record.environmentId)
                        addProperty("experimentId", record.experimentId)
                        addProperty("experimentVersionId", record.experimentVersionId)
                        addProperty("variantId", record.variantId)
                        addProperty("allocationVersion", record.allocationVersion)
                        addProperty("assignmentKeyType", record.assignmentKeyType)
                        addProperty("subjectDigest", record.subjectDigest)
                        addProperty("bucket", record.bucket)
                        addProperty("algorithm", record.algorithm)
                        addProperty("assignedAtEpochMillis", record.assignedAtEpochMillis)
                        record.groupId?.let { addProperty("groupId", it) }
                        record.groupVersionId?.let { addProperty("groupVersionId", it) }
                        record.groupBucket?.let { addProperty("groupBucket", it) }
                        addProperty("qaOverride", record.qaOverride)
                        addProperty("exposed", record.exposed)
                        addProperty("lastUpdatedAtEpochMillis", record.lastUpdatedAtEpochMillis)
                    },
                )
            }
        }.toString()

    fun decode(source: String): List<MosaicExperimentAssignmentRecord> =
        JsonParser.parseString(source).asJsonArray.map { element ->
            val value = element.asJsonObject
            require(value.keySet().all { it in acceptedKeys } && value.keySet().containsAll(requiredKeys)) {
                "A Mosaic Experiment assignment record has an unexpected shape."
            }
            MosaicExperimentAssignmentRecord(
                projectId = value.string("projectId"),
                environmentId = value.string("environmentId"),
                experimentId = value.string("experimentId"),
                experimentVersionId = value.string("experimentVersionId"),
                variantId = value.string("variantId"),
                allocationVersion = value.string("allocationVersion"),
                assignmentKeyType = value.string("assignmentKeyType"),
                subjectDigest = value.string("subjectDigest"),
                bucket = value.int("bucket"),
                algorithm = value.string("algorithm"),
                assignedAtEpochMillis = value.long("assignedAtEpochMillis"),
                groupId = value.optionalString("groupId"),
                groupVersionId = value.optionalString("groupVersionId"),
                groupBucket = value.get("groupBucket")?.let { value.int("groupBucket") },
                qaOverride = value.boolean("qaOverride"),
                exposed = value.boolean("exposed"),
                lastUpdatedAtEpochMillis = value.long("lastUpdatedAtEpochMillis"),
            )
        }

    private fun JsonObject.string(key: String): String = requireNotNull(optionalString(key))

    private fun JsonObject.optionalString(key: String): String? = get(key)?.let {
        require(it.isJsonPrimitive && it.asJsonPrimitive.isString) { "$key must be a string." }
        it.asString
    }

    private fun JsonObject.number(key: String) = requireNotNull(get(key)).also {
        require(it.isJsonPrimitive && it.asJsonPrimitive.isNumber) { "$key must be a number." }
    }

    private fun JsonObject.int(key: String): Int = number(key).asInt
    private fun JsonObject.long(key: String): Long = number(key).asLong

    private fun JsonObject.boolean(key: String): Boolean = requireNotNull(get(key)).let {
        require(it.isJsonPrimitive && it.asJsonPrimitive.isBoolean) { "$key must be a boolean." }
        it.asBoolean
    }
}

/** Bounded, atomic, app-private no-backup diagnostics/replay storage. */
class MosaicExperimentAssignmentStore internal constructor(context: Context, namespace: String) {
    private val lock = Mutex()
    private val file = File(context.applicationContext.noBackupFilesDir, "mosaic/experiment/$namespace/assignments.json")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))

    internal fun markExposedBestEffort(
        attribution: MosaicExperimentAttribution,
        assignmentKeyType: String,
        assignmentSubjectDigest: String,
        nowEpochMillis: Long,
    ) {
        scope.launch { runCatching { markExposed(attribution, assignmentKeyType, assignmentSubjectDigest, nowEpochMillis) } }
    }

    suspend fun record(result: MosaicExperimentAssignmentResult.Assigned, identityValue: String, nowEpochMillis: Long) = lock.withLock {
        val current = read()
        val assignment = result.assignment
        val digest = subjectDigest(identityValue)
        val keyMatches: (MosaicExperimentAssignmentRecord) -> Boolean = {
            it.projectId == assignment.projectId && it.environmentId == assignment.environmentId &&
                it.experimentVersionId == assignment.experimentVersionId &&
                it.assignmentKeyType == result.assignmentKeyType.experimentWireName() && it.subjectDigest == digest
        }
        val prior = current.firstOrNull(keyMatches)
        val replacement = MosaicExperimentAssignmentRecord(
            assignment.projectId, assignment.environmentId, assignment.experimentId, assignment.experimentVersionId,
            result.variant.id, assignment.allocationVersion, result.assignmentKeyType.experimentWireName(), digest,
            result.bucket, MOSAIC_EXPERIMENT_BUCKETING_ALGORITHM, prior?.assignedAtEpochMillis ?: nowEpochMillis,
            assignment.mutualExclusionGroup?.id, assignment.mutualExclusionGroup?.versionId, result.groupBucket,
            result.qaOverride, prior?.exposed == true, nowEpochMillis,
        )
        write((current.filterNot(keyMatches) + replacement).pruned(nowEpochMillis))
    }

    suspend fun markExposed(
        attribution: MosaicExperimentAttribution,
        assignmentKeyType: String,
        assignmentSubjectDigest: String,
        nowEpochMillis: Long,
    ) = lock.withLock {
        val current = read()
        write(current.map {
            if (
                it.experimentVersionId == attribution.experimentVersionId && it.variantId == attribution.experimentVariantId &&
                it.assignmentKeyType == assignmentKeyType && it.subjectDigest == assignmentSubjectDigest
            ) {
                it.copy(exposed = true, lastUpdatedAtEpochMillis = nowEpochMillis)
            } else it
        }.pruned(nowEpochMillis))
    }

    suspend fun clearSubject(keyType: MosaicAssignmentKeyType, identityValue: String) = lock.withLock {
        val digest = subjectDigest(identityValue)
        write(read().filterNot { it.assignmentKeyType == keyType.experimentWireName() && it.subjectDigest == digest })
    }

    suspend fun diagnostics(): List<MosaicExperimentAssignmentRecord> = lock.withLock { read().pruned(System.currentTimeMillis()) }

    private suspend fun read(): List<MosaicExperimentAssignmentRecord> = withContext(Dispatchers.IO) {
        if (!file.isFile) return@withContext emptyList()
        runCatching { MosaicExperimentAssignmentRecordCodec.decode(file.readText()) }.getOrNull().orEmpty()
    }

    private suspend fun write(records: List<MosaicExperimentAssignmentRecord>) = withContext(Dispatchers.IO) {
        file.parentFile?.let { if (!it.isDirectory && !it.mkdirs()) error("Could not create Mosaic Experiment directory.") }
        val temporary = File.createTempFile("assignments-", ".tmp", file.parentFile)
        try {
            FileOutputStream(temporary).use { output ->
                output.writer(Charsets.UTF_8).buffered().use { writer ->
                    writer.write(MosaicExperimentAssignmentRecordCodec.encode(records)); writer.flush(); output.fd.sync()
                }
            }
            if (!temporary.renameTo(file)) error("Could not atomically persist Mosaic Experiment assignments.")
        } finally {
            if (temporary.exists()) temporary.delete()
        }
    }

    private fun List<MosaicExperimentAssignmentRecord>.pruned(now: Long): List<MosaicExperimentAssignmentRecord> =
        filter { now - it.lastUpdatedAtEpochMillis <= MAX_RETENTION_MILLIS }
            .sortedByDescending(MosaicExperimentAssignmentRecord::lastUpdatedAtEpochMillis)
            .take(MAX_RECORDS)

    companion object {
        private const val MAX_RECORDS = 256
        private const val MAX_RETENTION_MILLIS = 180L * 24 * 60 * 60 * 1000
        internal fun subjectDigest(value: String): String = "sha256:" + MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}

/** A namespace has one mutex/store per process even when hosts create several SDK handles. */
internal object MosaicExperimentAssignmentStoreRegistry {
    private val stores = ConcurrentHashMap<String, MosaicExperimentAssignmentStore>()
    fun store(context: Context, namespace: String): MosaicExperimentAssignmentStore =
        stores.getOrPut(namespace) { MosaicExperimentAssignmentStore(context, namespace) }
}
