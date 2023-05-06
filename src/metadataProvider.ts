import * as azdata from "azdata";

/**
 * The metadata provider for Azure Data Studio. This is the data that will
 * show up in the dashboard. We don't currently show anything.
 */
export class MetadataProvider implements azdata.MetadataProvider {
    // #region Properties

    public handle?: number | undefined;

    public readonly providerId: string = "magnus";

    // #endregion

    /**
     * Creates a new instance of {@link MetadataProvider}.
     */
    public constructor() {

    }

    // #region MetadataProvider Implementation

    getMetadata(connectionUri: string): Thenable<azdata.ProviderMetadata> {
        // Frankly, don't know what this is used by, so just return an empty
        // result of metadata.
        return Promise.resolve({
            objectMetadata: []
        });
    }

    getDatabases(connectionUri: string): Thenable<string[] | azdata.DatabaseInfo[]> {
        // This is the list of database that shows up in the main dashboard.
        // For now, we don't want to show anything otherwise it just looks like
        // we are missing stuff when they double click it.
        return Promise.resolve([]);
    }

    getTableInfo(connectionUri: string, metadata: azdata.ObjectMetadata): Thenable<azdata.ColumnMetadata[]> {
        throw new Error('Method not implemented.');
    }

    getViewInfo(connectionUri: string, metadata: azdata.ObjectMetadata): Thenable<azdata.ColumnMetadata[]> {
        throw new Error('Method not implemented.');
    }

    // #endregion
}

