import * as azdata from "azdata";
import * as vscode from "vscode";
import { Api } from "./api";
import { v4 } from "uuid";

type Connection = {
    api?: Api;

    cancelled?: boolean;
};

/**
 * The connection provider handles initiating connections to the Rock server
 * and also keeping track of those connections.
 */
export class ConnectionProvider implements azdata.ConnectionProvider {
    // #region Properties

    handle?: number | undefined;
    public readonly providerId: string = "magnus";

    private connections: Record<string, Connection> = {};

    private onConnectionComplete: vscode.EventEmitter<azdata.ConnectionInfoSummary> = new vscode.EventEmitter();

    // #endregion

    // #region ConnectionProvider Implementation

    public getConnectionApi(connectionUri: string): Api | undefined {
        return this.connections[connectionUri]?.api;
    }

    public renameUri(newUri: string, oldUri: string): void {
        const api = this.connections[oldUri];

        if (!api) {
            return;
        }

        delete this.connections[oldUri];
        this.connections[newUri] = api;
    }

    async connect(connectionUri: string, connectionInfo: azdata.ConnectionInfo): Promise<boolean> {
        const connection: Connection = {};

        this.connections[connectionUri] = connection;

        try {
            const api = await Api.connect(connectionInfo.options.server, connectionInfo.options.user, connectionInfo.options.password);

            if (connection.cancelled) {
                return false;
            }

            connection.api = api;
        }
        catch (error) {
            this.onConnectionComplete.fire(<azdata.ConnectionInfoSummary>{
                ownerUri: connectionUri,
                errorMessage: error instanceof Error ? error.message : String(error)
            });

            return false;
        }

        const info = {
            connectionId: v4(),
            ownerUri: connectionUri,
            messages: "",
            errorMessage: "",
            errorNumber: 0,
            connectionSummary: {
                serverName: connectionInfo.options.server,
                databaseName: connection.api.serverDetails.databaseName,
                userName: connectionInfo.options.user
            },
            serverInfo: {
                serverReleaseVersion: 1,
                engineEditionId: 1,
                serverVersion: connection.api.serverDetails.rockVersion,
                serverLevel: "",
                serverEdition: connection.api.serverDetails.sqlEdition,
                isCloud: true,
                azureVersion: 1,
                osVersion: connection.api.serverDetails.oSVersion,
                options: {
                    osVersion: connection.api.serverDetails.oSVersion,
                    rockVersion: connection.api.serverDetails.rockVersion,
                    sqlEdition: connection.api.serverDetails.sqlEdition,
                    sqlVersion: connection.api.serverDetails.sqlVersion
                }
            }
        };

        this.onConnectionComplete.fire(info);

        return true;
    }

    disconnect(connectionUri: string): Promise<boolean> {
        if (this.connections[connectionUri]) {
            delete this.connections[connectionUri];
        }

        return Promise.resolve(true);
    }

    cancelConnect(connectionUri: string): Promise<boolean> {
        if (this.connections[connectionUri]) {
            this.connections[connectionUri].cancelled = true;
            delete this.connections[connectionUri];
        }

        return Promise.resolve(true);
    }

    async listDatabases(connectionUri: string): Promise<azdata.ListDatabasesResult> {
        const api = this.getConnectionApi(connectionUri);

        if (!api) {
            return Promise.resolve({
                databaseNames: []
            });
        }

        return Promise.resolve({
            databaseNames: [api.serverDetails.databaseName]
        });
    }

    changeDatabase(connectionUri: string, newDatabase: string): Promise<boolean> {
        return Promise.resolve(true);
    }

    rebuildIntelliSenseCache(connectionUri: string): Thenable<void> {
        throw new Error('Method not implemented.');
    }

    getConnectionString(connectionUri: string, includePassword: boolean): Thenable<string> {
        throw new Error('Method not implemented.');
    }

    buildConnectionInfo(connectionString: string): Thenable<azdata.ConnectionInfo> {
        return Promise.resolve({
            options: {}
        });
    }

    registerOnConnectionComplete(handler: (connSummary: azdata.ConnectionInfoSummary) => any): void {
        this.onConnectionComplete.event(e => handler(e));
    }

    registerOnIntelliSenseCacheComplete(handler: (connectionUri: string) => any): void {
        //throw new Error('Method not implemented.');
    }

    registerOnConnectionChanged(handler: (changedConnInfo: azdata.ChangedConnectionInfo) => any): void {
        //throw new Error('Method not implemented.');
    }

    // #endregion
}

