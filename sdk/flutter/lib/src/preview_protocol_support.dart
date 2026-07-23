part of 'preview_protocol.dart';

String _validatedString(
  String value, {
  required String name,
  required int minimumLength,
  required int maximumLength,
  required RegExp pattern,
}) {
  if (value.length < minimumLength ||
      value.length > maximumLength ||
      !pattern.hasMatch(value)) {
    throw ArgumentError.value(value, name, 'Value does not satisfy contract.');
  }
  return value;
}

String _safeDisplayName(String value, String name) =>
    _safeString(value, name, 80);

String _safeString(Object? value, String name, int maximumLength) {
  final string = value is String ? value : null;
  if (string == null ||
      string.isEmpty ||
      string.length > maximumLength ||
      string.contains('\n') ||
      string.contains('\r')) {
    throw ArgumentError.value(
        value, name, 'Value must be safe single-line text.');
  }
  return string;
}

Map<String, Object?> _object(Object? value, String path) {
  if (value is! Map<String, Object?>) {
    throw MosaicPreviewProtocolException('Expected an object at $path.');
  }
  return value;
}

List<Object?> _list(Object? value, String path) {
  if (value is! List<Object?>) {
    throw MosaicPreviewProtocolException('Expected an array at $path.');
  }
  return value;
}

String _string(Object? value, String path) {
  if (value is! String || value.isEmpty) {
    throw MosaicPreviewProtocolException('Expected a string at $path.');
  }
  return value;
}

String _patternString(Object? value, String path, RegExp pattern) {
  final string = _string(value, path);
  final (minimumLength, maximumLength) = switch (pattern) {
    _ when identical(pattern, _messageIdPattern) => (5, 100),
    _ when identical(pattern, _sessionIdPattern) => (9, 100),
    _ when identical(pattern, _clientIdPattern) => (8, 100),
    _ when identical(pattern, _documentIdPattern) => (10, 100),
    _ when identical(pattern, _revisionIdPattern) => (10, 100),
    _ when identical(pattern, _machineIdentifierPattern) => (1, 128),
    _ when identical(pattern, _semanticVersionPattern) => (1, 64),
    _ when identical(pattern, _localePattern) => (2, 7),
    _ => (1, 512),
  };
  if (string.length < minimumLength ||
      string.length > maximumLength ||
      !pattern.hasMatch(string)) {
    throw MosaicPreviewProtocolException('Invalid value at $path.');
  }
  return string;
}

String _enumString(
  Object? value,
  String path,
  Set<String> allowed,
) {
  final string = _string(value, path);
  if (!allowed.contains(string)) {
    throw MosaicPreviewProtocolException('Unsupported value at $path.');
  }
  return string;
}

int _integer(
  Object? value,
  String path, {
  required int minimum,
  int maximum = 2147483647,
}) {
  if (value is! num || !value.isFinite || value != value.truncateToDouble()) {
    throw MosaicPreviewProtocolException('Expected an integer at $path.');
  }
  final integer = value.toInt();
  if (integer < minimum || integer > maximum) {
    throw MosaicPreviewProtocolException('Integer out of range at $path.');
  }
  return integer;
}

double _number(Object? value, String path) {
  if (value is! num || !value.isFinite) {
    throw MosaicPreviewProtocolException('Expected a number at $path.');
  }
  return value.toDouble();
}

void _expectKeys(
  Map<String, Object?> object,
  Set<String> allowed,
  String path, {
  Set<String>? required,
}) {
  final requiredKeys = required ?? allowed;
  final missing = requiredKeys.difference(object.keys.toSet());
  final extra = object.keys.toSet().difference(allowed);
  if (missing.isNotEmpty || extra.isNotEmpty) {
    throw MosaicPreviewProtocolException('Unexpected fields at $path.');
  }
}

const List<String> mosaicLocalPreviewVersionPreference = <String>[
  mosaicLocalPreviewV02ProtocolVersion,
  mosaicLocalPreviewProtocolVersion,
];
