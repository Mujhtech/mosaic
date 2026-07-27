import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:path_provider/path_provider.dart';

import 'sha256.dart';

/// Safe diagnostic code reported when identity persistence is unavailable.
const String mosaicIdentityStorageUnavailableCode =
    'identity.storage_unavailable';

sealed class MosaicAttributeValue {
  const MosaicAttributeValue();

  String get type;
  Object get value;

  Map<String, Object> toJson() =>
      <String, Object>{'type': type, 'value': value};
}

final class MosaicStringAttribute extends MosaicAttributeValue {
  const MosaicStringAttribute(this.value);
  @override
  final String value;
  @override
  String get type => 'string';
}

final class MosaicBooleanAttribute extends MosaicAttributeValue {
  const MosaicBooleanAttribute(this.value);
  @override
  final bool value;
  @override
  String get type => 'boolean';
}

final class MosaicNumberAttribute extends MosaicAttributeValue {
  MosaicNumberAttribute(num value) : value = value == 0 ? 0 : value.toDouble() {
    if (!this.value.isFinite) {
      throw ArgumentError.value(value, 'value', 'must be finite');
    }
  }
  @override
  final num value;
  @override
  String get type => 'number';
}

final class MosaicTimestampAttribute extends MosaicAttributeValue {
  MosaicTimestampAttribute(DateTime value) : value = value.toUtc();
  @override
  final DateTime value;
  @override
  String get type => 'timestamp';
  @override
  Map<String, Object> toJson() => <String, Object>{
        'type': type,
        'value': value.toIso8601String(),
      };
}

final class MosaicSemanticVersionAttribute extends MosaicAttributeValue {
  const MosaicSemanticVersionAttribute(this.value);
  @override
  final String value;
  @override
  String get type => 'semantic_version';
}

final class MosaicStringListAttribute extends MosaicAttributeValue {
  MosaicStringListAttribute(Iterable<String> value)
      : value = List.unmodifiable(value) {
    if (this.value.isEmpty ||
        this.value.length > 16 ||
        this.value.toSet().length != this.value.length) {
      throw ArgumentError.value(
          value, 'value', 'must contain 1–16 unique values');
    }
  }
  @override
  final List<String> value;
  @override
  String get type => 'string_list';
}

final class MosaicIdentityState {
  MosaicIdentityState({
    required this.installationId,
    required this.generation,
    this.userId,
    Map<String, MosaicAttributeValue> attributes =
        const <String, MosaicAttributeValue>{},
  }) : attributes = Map.unmodifiable(attributes);

  final String installationId;
  final String? userId;
  final int generation;
  final Map<String, MosaicAttributeValue> attributes;
}

abstract interface class MosaicIdentityStorage {
  Future<String?> read(String namespace);
  Future<void> write(String namespace, String source);
}

final class MosaicMemoryIdentityStorage implements MosaicIdentityStorage {
  String? source;
  @override
  Future<String?> read(String namespace) async => source;
  @override
  Future<void> write(String namespace, String source) async {
    this.source = source;
  }
}

typedef MosaicIdentityDirectoryProvider = Future<Directory> Function();

Future<Directory> _identityDirectory() => getApplicationSupportDirectory();

final class MosaicFileIdentityStorage implements MosaicIdentityStorage {
  const MosaicFileIdentityStorage({
    MosaicIdentityDirectoryProvider directoryProvider = _identityDirectory,
  }) : _directoryProvider = directoryProvider;

  final MosaicIdentityDirectoryProvider _directoryProvider;

  @override
  Future<String?> read(String namespace) async {
    final file = await _file(namespace);
    if (!await file.exists()) return null;
    if ((await file.stat()).size > 12 * 1024) {
      throw const FormatException('Mosaic identity state exceeds its limit.');
    }
    return file.readAsString();
  }

  @override
  Future<void> write(String namespace, String source) async {
    final target = await _file(namespace);
    await target.parent.create(recursive: true);
    final temporary = File(
      '${target.path}.tmp-${DateTime.now().microsecondsSinceEpoch}',
    );
    try {
      await temporary.writeAsString(source, flush: true);
      await temporary.rename(target.path);
    } on Object {
      if (await temporary.exists()) await temporary.delete();
      rethrow;
    }
  }

  Future<File> _file(String namespace) async {
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(namespace)) {
      throw ArgumentError.value(
          namespace, 'namespace', 'Invalid identity key.');
    }
    final directory = await _directoryProvider();
    return File('${directory.path}/mosaic/identity-$namespace.json');
  }
}

final class MosaicIdentityController {
  MosaicIdentityController({required this.storage, required this.namespace});

  final MosaicIdentityStorage storage;
  final String namespace;
  MosaicIdentityState? _state;
  Future<MosaicIdentityState>? _operation;
  Future<void> _mutations = Future<void>.value();
  String? _lastSafeCode;

  MosaicIdentityState? get current => _state;

  /// Safe diagnostic code for the most recent identity-storage failure. The
  /// controller keeps serving in-memory identity when persistence fails.
  String? get lastSafeCode => _lastSafeCode;

  Future<MosaicIdentityState> load() =>
      _state == null ? (_operation ??= _load()) : Future.value(_state);

  Future<MosaicIdentityState> _load() async {
    try {
      try {
        final source = await storage.read(namespace);
        if (source != null) _state = _decode(source);
      } on Object {
        _state = null;
        _lastSafeCode = mosaicIdentityStorageUnavailableCode;
      }
      final state = _state ??
          MosaicIdentityState(
            installationId: _newIdentity('installation'),
            generation: 1,
          );
      _state = state;
      await _persistSafely(state);
      return state;
    } finally {
      // Always released so a single storage failure cannot permanently poison
      // identity resolution for the rest of the process lifetime.
      _operation = null;
    }
  }

  Future<MosaicIdentityState> identify(String userId) =>
      _enqueue(() => _identify(userId));

  Future<MosaicIdentityState> _identify(String userId) async {
    final normalized = _identity(userId, 'userId');
    final state = await load();
    if (state.userId == normalized) return state;
    return _replace(MosaicIdentityState(
      installationId: state.installationId,
      userId: normalized,
      generation: state.generation + 1,
      attributes: state.attributes,
    ));
  }

  Future<MosaicIdentityState> setAttributes(
    Map<String, MosaicAttributeValue> attributes,
  ) =>
      _enqueue(() => _setAttributes(attributes));

  Future<MosaicIdentityState> _setAttributes(
    Map<String, MosaicAttributeValue> attributes,
  ) async {
    _validateAttributes(attributes);
    final state = await load();
    return _replace(MosaicIdentityState(
      installationId: state.installationId,
      userId: state.userId,
      generation: state.generation + 1,
      attributes: attributes,
    ));
  }

  Future<MosaicIdentityState> resetUser() => _enqueue(_resetUser);

  Future<MosaicIdentityState> _resetUser() async {
    final state = await load();
    if (state.userId == null && state.attributes.isEmpty) return state;
    return _replace(MosaicIdentityState(
      installationId: state.installationId,
      generation: state.generation + 1,
    ));
  }

  Future<MosaicIdentityState> rotateInstallation() =>
      _enqueue(_rotateInstallation);

  Future<MosaicIdentityState> _rotateInstallation() async {
    final state = await load();
    return _replace(MosaicIdentityState(
      installationId: _newIdentity('installation'),
      generation: state.generation + 1,
    ));
  }

  Future<MosaicIdentityState> _replace(MosaicIdentityState state) async {
    await _persistSafely(state);
    _state = state;
    return state;
  }

  /// Writes identity state, degrading to a safe diagnostic code when the
  /// injected storage fails. Identity remains valid for the session.
  Future<void> _persistSafely(MosaicIdentityState state) async {
    try {
      await _persist(state);
    } on Object {
      _lastSafeCode = mosaicIdentityStorageUnavailableCode;
    }
  }

  Future<MosaicIdentityState> _enqueue(
    Future<MosaicIdentityState> Function() operation,
  ) {
    final completer = Completer<MosaicIdentityState>();
    _mutations = _mutations.then((_) async {
      try {
        completer.complete(await operation());
      } on Object catch (error, stackTrace) {
        completer.completeError(error, stackTrace);
      }
    });
    return completer.future;
  }

  Future<void> _persist(MosaicIdentityState state) => storage.write(
        namespace,
        jsonEncode(<String, Object?>{
          'version': 1,
          'installationId': state.installationId,
          'userId': state.userId,
          'generation': state.generation,
          'attributes': <String, Object>{
            for (final entry in state.attributes.entries)
              entry.key: entry.value.toJson(),
          },
        }),
      );

  static MosaicIdentityState _decode(String source) {
    final value = jsonDecode(source);
    if (value is! Map || value['version'] != 1) throw const FormatException();
    final object = value.cast<String, Object?>();
    final installationId =
        _identity(object['installationId'], 'installationId');
    final userId = object['userId'];
    final generation = object['generation'];
    final rawAttributes = object['attributes'];
    if (userId != null && userId is! String ||
        generation is! int ||
        generation < 1 ||
        rawAttributes is! Map) throw const FormatException();
    final attributes = <String, MosaicAttributeValue>{};
    for (final entry in rawAttributes.entries) {
      if (entry.key is! String || entry.value is! Map)
        throw const FormatException();
      final typed = (entry.value as Map).cast<String, Object?>();
      attributes[entry.key as String] = _attribute(typed);
    }
    _validateAttributes(attributes);
    return MosaicIdentityState(
      installationId: installationId,
      userId: userId as String?,
      generation: generation,
      attributes: attributes,
    );
  }
}

MosaicAttributeValue _attribute(Map<String, Object?> value) {
  final raw = value['value'];
  return switch (value['type']) {
    'string' when raw is String => MosaicStringAttribute(raw),
    'boolean' when raw is bool => MosaicBooleanAttribute(raw),
    'number' when raw is num => MosaicNumberAttribute(raw),
    'timestamp' when raw is String =>
      MosaicTimestampAttribute(DateTime.parse(raw)),
    'semantic_version' when raw is String =>
      MosaicSemanticVersionAttribute(raw),
    'string_list' when raw is List && raw.every((item) => item is String) =>
      MosaicStringListAttribute(raw.cast<String>()),
    _ => throw const FormatException('Invalid Mosaic attribute.'),
  };
}

void _validateAttributes(Map<String, MosaicAttributeValue> attributes) {
  if (attributes.length > 32)
    throw ArgumentError('At most 32 attributes are allowed.');
  for (final entry in attributes.entries) {
    if (!RegExp(r'^[a-z][a-z0-9_]{0,63}$').hasMatch(entry.key)) {
      throw ArgumentError.value(
          entry.key, 'attributes', 'Invalid attribute key.');
    }
    final value = entry.value;
    if (value is MosaicStringAttribute &&
            utf8.encode(value.value).length > 256 ||
        value is MosaicSemanticVersionAttribute && value.value.length > 128 ||
        value is MosaicStringListAttribute &&
            value.value.any((item) => utf8.encode(item).length > 128)) {
      throw ArgumentError.value(
          value.value, entry.key, 'Attribute exceeds its limit.');
    }
  }
  final encoded = jsonEncode(<String, Object>{
    for (final entry in attributes.entries) entry.key: entry.value.toJson(),
  });
  if (utf8.encode(encoded).length > 8 * 1024) {
    throw ArgumentError('Serialized attributes exceed 8 KiB.');
  }
}

String _identity(Object? value, String name) {
  if (value is! String ||
      value.isEmpty ||
      value.length > 256 ||
      value.runes.any((rune) => rune < 0x20 || rune == 0x7f)) {
    throw FormatException('Invalid $name.');
  }
  return value;
}

String _newIdentity(String prefix) {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  return '${prefix}_${bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join()}';
}

String mosaicIdentityNamespace(Uri baseUrl, String publicSdkKey) =>
    mosaicSha256String('${baseUrl.toString()}\n$publicSdkKey\nidentity-v1');
