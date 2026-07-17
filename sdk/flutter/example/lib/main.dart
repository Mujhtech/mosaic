import 'package:flutter/material.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

void main() {
  final mosaic = Mosaic.configure(
    apiKey: 'public_example_key',
    purchaseProvider: MockMosaicPurchaseProvider(),
  );
  runApp(MosaicPackageExample(mosaic: mosaic));
}

final class MosaicPackageExample extends StatelessWidget {
  const MosaicPackageExample({required this.mosaic, super.key});

  final Mosaic mosaic;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        appBar: AppBar(title: const Text('Mosaic Flutter RC1')),
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            'Configured ${mosaic.configuration.apiKey}. '
            'Protocol ${mosaicFlutterCapabilityReport.supportedSchemaVersions.single} '
            'supports ${mosaicFlutterCapabilityReport.supportedCapabilities.length} '
            'capabilities. Run examples/flutter-example for the complete native paywall.',
          ),
        ),
      ),
    );
  }
}
