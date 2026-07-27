# The Mosaic Android SDK contains no reflection-based models, so it needs no consumer keep rules.
#
# Every persisted or transmitted document is encoded and decoded by an explicit Gson tree codec
# that reads and writes literal wire names (protocol documents, the analytics queue, the
# configuration cache record, and Experiment assignment records). Gson's reflective object binding
# is never used, and no Mosaic type is looked up by name at runtime, so R8 may freely rename,
# repackage, and shrink Mosaic classes and fields without changing any persisted or wire shape.
#
# Gson itself is only used for its JSON tree and string-escaping APIs; the `com.google.gson`
# artifact ships its own consumer rules for the reflective paths Mosaic does not use.
#
# Verification: `examples/android-example` runs R8 in its `release` build type, so
# `:app:assembleRelease` fails if a Mosaic dependency ever begins to require keep rules.
