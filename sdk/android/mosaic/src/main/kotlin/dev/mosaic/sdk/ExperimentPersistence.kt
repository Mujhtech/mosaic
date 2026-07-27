package dev.mosaic.sdk

import android.content.Context
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
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

/** Bounded, atomic, app-private no-backup diagnostics/replay storage. */
class MosaicExperimentAssignmentStore internal constructor(context: Context, namespace: String) {
    private val lock = Mutex()
    private val gson = Gson()
    private val file = File(context.applicationContext.noBackupFilesDir, "mosaic/experiment/$namespace/assignments.json")
    private val listType = object : TypeToken<List<MosaicExperimentAssignmentRecord>>() {}.type
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
        runCatching { gson.fromJson<List<MosaicExperimentAssignmentRecord>>(file.readText(), listType) }.getOrNull().orEmpty()
    }

    private suspend fun write(records: List<MosaicExperimentAssignmentRecord>) = withContext(Dispatchers.IO) {
        file.parentFile?.let { if (!it.isDirectory && !it.mkdirs()) error("Could not create Mosaic Experiment directory.") }
        val temporary = File.createTempFile("assignments-", ".tmp", file.parentFile)
        try {
            FileOutputStream(temporary).use { output ->
                output.writer(Charsets.UTF_8).buffered().use { writer -> writer.write(gson.toJson(records)); writer.flush(); output.fd.sync() }
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
