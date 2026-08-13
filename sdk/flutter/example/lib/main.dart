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
        appBar: AppBar(
          title: const Text('Mosaic Flutter Protocol 0.4'),
        ),
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            'Configured ${mosaic.configuration.apiKey}. '
            'Strict reader: Protocol '
            '${mosaicFlutterCapabilityReport.schemaVersion}, '
            '${mosaicProtocolCapabilities.length} capabilities including '
            '${mosaicMotionCapabilities.length} motion primitives. '
            'Configuration Delivery v$mosaicConfigurationDeliveryVersion and '
            'Local Preview $mosaicLocalPreviewProtocolVersion carry the same '
            'paywall protocol. Run examples/flutter-example for the complete '
            'native paywall.',
          ),
        ),
      ),
    );
  }
}
