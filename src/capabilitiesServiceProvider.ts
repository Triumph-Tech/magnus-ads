import * as azdata from "azdata";

/**
 * Describes some of the capabilities supported by the extension.
 */
export class CapabilitiesServiceProvider implements azdata.CapabilitiesProvider {
    // #region Properties

    handle?: number | undefined;

    public readonly providerId: string = "magnus";

    // #endregion

    getServerCapabilities(client: azdata.DataProtocolClientCapabilities): Promise<azdata.DataProtocolServerCapabilities> {
        return Promise.resolve({
            protocolVersion: "1.0",
            providerName: "magnus",
            providerDisplayName: "Magnus",
            connectionProvider: {
                options: []
            },
            adminServicesProvider: <azdata.AdminServicesOptions>{},
            features: [
                // Enable the export features.
                {
                    enabled: true,
                    featureName: 'serializationService',
                    optionsMetadata: []
                }
            ],
        });
    }
}

