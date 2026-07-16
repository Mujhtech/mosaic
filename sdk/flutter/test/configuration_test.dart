import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

void main() {
  test('configures an isolated Mosaic client', () {
    final provider = MockMosaicPurchaseProvider();
    final mosaic = Mosaic.configure(
      apiKey: ' public_test_key ',
      endpoint: Uri.parse('http://localhost:8080'),
      purchaseProvider: provider,
    );

    expect(mosaic.configuration.apiKey, 'public_test_key');
    expect(mosaic.configuration.endpoint, Uri.parse('http://localhost:8080'));
    expect(mosaic.purchaseProvider, same(provider));
  });

  test('rejects an empty key and relative endpoint', () {
    expect(
      () => MosaicConfiguration(apiKey: '  '),
      throwsA(isA<MosaicConfigurationException>()),
    );
    expect(
      () => MosaicConfiguration(
        apiKey: 'public_test_key',
        endpoint: Uri.parse('/local'),
      ),
      throwsA(isA<MosaicConfigurationException>()),
    );
  });
}
