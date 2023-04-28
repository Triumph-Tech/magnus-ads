import * as vscode from 'vscode';
import * as azdata from 'azdata';
import { v4 } from 'uuid';
import { QueryRunner } from './queryRunner';
import { Api } from './api';
import { ObjectExplorerNodeBag, ObjectExplorerNodeType } from './types';
import { ExportToCsv, ExportToJson, IExportSerializer } from './serializers/exportToCsv';

/**
 * Most parts of Azure Data Studio we are dealing with are expecting to
 * talk to a remote language server. It has expectations of some delays
 * for every call. Because of that, there are some bugs where sometimes
 * the "response listener" isn't created until after the command function
 * returns. But we have already sent the response in some cases because
 * we don't need to talk to a remote language server. This tricks ADS
 * into thinking that is happening by introducing a short delay.
 * 
 * @param callback The callback function to execute.
 */
function runClientRequest(callback: (() => void | Promise<void>)) {
    setTimeout(callback, 10);
}

function toElapsed(totalMilliseconds: number): string {
    const hours = Math.floor(totalMilliseconds / (1000 * 60 * 60));
    totalMilliseconds = totalMilliseconds % (1000 * 60 * 60);

    const minutes = Math.floor(totalMilliseconds / (1000 * 60));
    totalMilliseconds = totalMilliseconds % (1000 * 60);

    const seconds = Math.floor(totalMilliseconds / 1000);
    const milliseconds = totalMilliseconds % 1000;

    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`
}

function getObjectExplorerNodeIcon(nodeBag: ObjectExplorerNodeBag): azdata.SqlThemeIcon | undefined {
    switch (nodeBag.type) {
        case ObjectExplorerNodeType.DatabasesFolder:
        case ObjectExplorerNodeType.TablesFolder:
            return azdata.SqlThemeIcon.Folder;

        case ObjectExplorerNodeType.Database:
            return azdata.SqlThemeIcon.Database;
        
        case ObjectExplorerNodeType.Table:
            return azdata.SqlThemeIcon.Table;

        default:
            return undefined;
    }
}

function getObjectExplorerNodeIsLeaf(nodeBag: ObjectExplorerNodeBag): boolean {
    switch (nodeBag.type) {
        case ObjectExplorerNodeType.DatabasesFolder:
        case ObjectExplorerNodeType.TablesFolder:
        case ObjectExplorerNodeType.Database:
            return false;

        default:
            return true;
    }
}

function getObjectExplorerNodeInfo(nodeBag: ObjectExplorerNodeBag): azdata.NodeInfo {
    return {
        nodePath: nodeBag.id,
        nodeType: nodeBag.type.toString(),
        label: nodeBag.name,
        icon: getObjectExplorerNodeIcon(nodeBag),
        isLeaf: getObjectExplorerNodeIsLeaf(nodeBag)
    };
}

type Connection = {
    api?: Api;

    cancelled?: boolean;
};

class ConnectionProvider implements azdata.ConnectionProvider {
    handle?: number | undefined;
    public readonly providerId: string = "magnus";

    private connections: Record<string, Connection> = {};

    private onConnectionComplete: vscode.EventEmitter<azdata.ConnectionInfoSummary> = new vscode.EventEmitter();

    public constructor() {
    }

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
}

class QueryProvider implements azdata.QueryProvider {
    public handle?: number | undefined;
    public readonly providerId: string = "magnus";

    private connectionProvider: ConnectionProvider;

    private activeQueries: Record<string, QueryRunner> = {};

    private onQueryComplete: vscode.EventEmitter<azdata.QueryExecuteCompleteNotificationResult> = new vscode.EventEmitter();
    private onResultSetAvailable: vscode.EventEmitter<azdata.QueryExecuteResultSetNotificationParams> = new vscode.EventEmitter();
    private onBatchStart: vscode.EventEmitter<azdata.QueryExecuteBatchNotificationParams> = new vscode.EventEmitter();
    private onBatchComplete: vscode.EventEmitter<azdata.QueryExecuteBatchNotificationParams> = new vscode.EventEmitter();
    private onMessage: vscode.EventEmitter<azdata.QueryExecuteMessageParams> = new vscode.EventEmitter();

    public constructor(connectionProvider: ConnectionProvider) {
        this.connectionProvider = connectionProvider;
    }

    public connectionUriChanged(newUri: string, oldUri: string): void {
        this.connectionProvider.renameUri(newUri, oldUri);
    }

    cancelQuery(ownerUri: string): Promise<azdata.QueryCancelResult> {
        if (ownerUri in this.activeQueries) {
            this.activeQueries[ownerUri].cancel();
            delete this.activeQueries[ownerUri];
        }

        this.onQueryComplete.fire({
            ownerUri,
            batchSummaries: []
        });

        return Promise.resolve<azdata.QueryCancelResult>({
            messages: "Cancelled the query."
        });
    }

    async runQuery(ownerUri: string, selection: azdata.ISelectionData | undefined, runOptions?: azdata.ExecutionPlanOptions | undefined): Promise<void> {
        const conn = await azdata.connection.getConnection(ownerUri);
        const connectionUri = await azdata.connection.getUriForConnection(conn.connectionId);
        const api = this.connectionProvider.getConnectionApi(connectionUri);

        if (!api) {
            throw new Error("Not connected to server.");
        }

        var doc = vscode.workspace.textDocuments.find(td => td.uri.toString() === ownerUri);

        runClientRequest(async () => {
            if (!doc) {
                // TODO Report error.
                return;
            }

            let text = doc.getText();

            if (!selection) {
                let lines = text.split("\n");
                selection = {
                    startLine: 0,
                    startColumn: 0,
                    endLine: lines.length - 1,
                    endColumn: lines[lines.length - 1].length
                };
            }

            const range = new vscode.Range(selection.startLine, selection.startColumn, selection.endLine, selection.endColumn);
            text = doc.getText(range);

            const query = new QueryRunner(api, text);
            this.activeQueries[ownerUri] = query;

            const start = new Date();

            const batch: azdata.BatchSummary = <azdata.BatchSummary>{
                id: 0,
                selection: selection,
                executionStart: start.toISOString()
            };

            this.onBatchStart.fire({
                ownerUri,
                batchSummary: batch
            });

            try {
                await query.execute();

                if (query.isCancelled()) {
                    return;
                }

                for (const message of query.getMessages()) {
                    this.onMessage.fire({
                        ownerUri,
                        message: {
                            batchId: batch.id,
                            isError: !!message.code,
                            message: message.message
                        }
                    });
                }

                const resultSetSummaries = query.getResultSetSummaries();

                for (const resultSetSummary of resultSetSummaries) {
                    this.onResultSetAvailable.fire({
                        ownerUri,
                        resultSetSummary
                    });
                }

                batch.hasError = false;
                batch.resultSetSummaries = resultSetSummaries;
            }
            catch (error) {
                batch.hasError = true;

                this.onMessage.fire({
                    ownerUri,
                    message: {
                        batchId: batch.id,
                        isError: true,
                        message: error instanceof Error ? error.message : `${error}`
                    }
                });
            }

            const end = new Date();
            batch.executionEnd = end.toISOString();
            batch.executionElapsed = toElapsed(end.getTime() - start.getTime());

            this.onBatchComplete.fire({
                ownerUri,
                batchSummary: batch
            });

            this.onQueryComplete.fire({
                ownerUri,
                batchSummaries: [batch]
            });
        });
    }

    runQueryStatement(ownerUri: string, line: number, column: number): Thenable<void> {
        throw new Error('Method not implemented.');
    }

    runQueryString(ownerUri: string, queryString: string): Thenable<void> {
        throw new Error('Method not implemented.');
    }

    runQueryAndReturn(ownerUri: string, queryString: string): Thenable<azdata.SimpleExecuteResult> {
        throw new Error('Method not implemented.');
    }

    parseSyntax(ownerUri: string, query: string): Thenable<azdata.SyntaxParseResult> {
        throw new Error('Method not implemented.');
    }

    async getQueryRows(rowData: azdata.QueryExecuteSubsetParams): Promise<azdata.QueryExecuteSubsetResult> {
        const query = this.activeQueries[rowData.ownerUri];

        if (!query) {
            throw new Error("Query was not found.");
        }

        return Promise.resolve(query.getResultSet(rowData.resultSetIndex, rowData.rowsStartIndex, rowData.rowsCount));
    }

    disposeQuery(ownerUri: string): Thenable<void> {
        delete this.activeQueries[ownerUri];

        return Promise.resolve();
    }

    async saveResults(requestParams: azdata.SaveResultsRequestParams): Promise<azdata.SaveResultRequestResult> {
        const query = this.activeQueries[requestParams.ownerUri];
        const summary = query.getResultSetSummaries()[requestParams.resultSetIndex];
        const rowCount = summary.rowCount;
        const rowData = query.getResultSet(requestParams.resultSetIndex, 0, rowCount);
        let serializer: IExportSerializer | undefined;

        if (requestParams.resultFormat === "csv") {
            serializer = new ExportToCsv(requestParams);
        }
        else if (requestParams.resultFormat === "json") {
            serializer = new ExportToJson(requestParams);
        }

        if (serializer) {
            await serializer.open(summary);

            for (const row of rowData.resultSubset.rows) {
                serializer.writeRow(row);
            }

            await serializer.close();

            return {
                messages: ""
            };
        }
        else {
            return {
                messages: "Format is not supported."
            };
        }
    }

    setQueryExecutionOptions(ownerUri: string, options: azdata.QueryExecutionOptions): Thenable<void> {
        throw new Error('Method not implemented.');
    }

    registerOnQueryComplete(handler: (result: azdata.QueryExecuteCompleteNotificationResult) => any): void {
        this.onQueryComplete.event(e => handler(e));
    }

    registerOnBatchStart(handler: (batchInfo: azdata.QueryExecuteBatchNotificationParams) => any): void {
        this.onBatchStart.event(e => handler(e));
    }

    registerOnBatchComplete(handler: (batchInfo: azdata.QueryExecuteBatchNotificationParams) => any): void {
        this.onBatchComplete.event(e => handler(e));
    }

    registerOnResultSetAvailable(handler: (resultSetInfo: azdata.QueryExecuteResultSetNotificationParams) => any): void {
        this.onResultSetAvailable.event(e => handler(e));
    }

    registerOnResultSetUpdated(handler: (resultSetInfo: azdata.QueryExecuteResultSetNotificationParams) => any): void {
        //throw new Error('Method not implemented.');
    }

    registerOnMessage(handler: (message: azdata.QueryExecuteMessageParams) => any): void {
        this.onMessage.event(e => handler(e));
    }

    // #region Cell Editing

    commitEdit(ownerUri: string): Thenable<void> {
        throw new Error('Method not implemented.');
    }

    createRow(ownerUri: string): Thenable<azdata.EditCreateRowResult> {
        throw new Error('Method not implemented.');
    }

    deleteRow(ownerUri: string, rowId: number): Thenable<void> {
        throw new Error('Method not implemented.');
    }

    disposeEdit(ownerUri: string): Thenable<void> {
        throw new Error('Method not implemented.');
    }

    initializeEdit(ownerUri: string, schemaName: string, objectName: string, objectType: string, rowLimit: number, queryString: string): Thenable<void> {
        throw new Error('Method not implemented.');
    }

    revertCell(ownerUri: string, rowId: number, columnId: number): Thenable<azdata.EditRevertCellResult> {
        throw new Error('Method not implemented.');
    }

    revertRow(ownerUri: string, rowId: number): Thenable<void> {
        throw new Error('Method not implemented.');
    }

    updateCell(ownerUri: string, rowId: number, columnId: number, newValue: string): Thenable<azdata.EditUpdateCellResult> {
        throw new Error('Method not implemented.');
    }

    getEditRows(rowData: azdata.EditSubsetParams): Thenable<azdata.EditSubsetResult> {
        throw new Error('Method not implemented.');
    }

    registerOnEditSessionReady(handler: (ownerUri: string, success: boolean, message: string) => any): void {
        //throw new Error('Method not implemented.');
    }

    // #endregion
}

class ObjectExplorerProvider implements azdata.ObjectExplorerProvider {
    handle?: number | undefined;
    public readonly providerId: string = "magnus";

    private connectionProvider: ConnectionProvider;

    private readonly sessions: Record<string, Api> = {};

    private onSessionCreatedEmitter: vscode.EventEmitter<azdata.ObjectExplorerSession> = new vscode.EventEmitter();
    private onSessionCreated: vscode.Event<azdata.ObjectExplorerSession> = this.onSessionCreatedEmitter.event;

    private readonly onExpandCompletedEmitter = new vscode.EventEmitter<azdata.ObjectExplorerExpandInfo>();
    private readonly onExpandCompleted = this.onExpandCompletedEmitter.event;


    constructor(connectionProvider: ConnectionProvider) {
        this.connectionProvider = connectionProvider;
    }

    public async createNewSession(connectionInfo: azdata.ConnectionInfo): Promise<azdata.ObjectExplorerSessionResponse> {
        const api = await Api.connect(connectionInfo.options.server, connectionInfo.options.user, connectionInfo.options.password);

        // const conn = await azdata.connection.getCurrentConnection();
        // const connectionUri = await azdata.connection.getUriForConnection(conn.connectionId);
        // const api = this.connectionProvider.getConnectionApi(connectionUri);

        if (!api) {
            throw new Error("Unable to locate server connection.");
        }

        // Get the API from the connectionUri like we do in query.
        const sessionId = v4();

        this.sessions[sessionId] = api;

        runClientRequest(() => {
            // Call API to get details...
            this.onSessionCreatedEmitter.fire({
                success: true,
                sessionId,
                rootNode: {
                    nodePath: "",
                    nodeType: "",
                    label: "Rock Server",
                    isLeaf: false
                }
            });
        });

        return {
            sessionId: sessionId
        };
    }

    closeSession(closeSessionInfo: azdata.ObjectExplorerCloseSessionInfo): Thenable<azdata.ObjectExplorerCloseSessionResponse> {
        if (!closeSessionInfo.sessionId) {
            throw new Error("Invalid call");
        }

        delete this.sessions[closeSessionInfo.sessionId];

        return Promise.resolve<azdata.ObjectExplorerCloseSessionResponse>({
            sessionId: closeSessionInfo.sessionId!,
            success: true
        });
    }

    public async expandNode(nodeInfo: azdata.ExpandNodeInfo): Promise<boolean> {
        if (!nodeInfo.sessionId || !this.sessions[nodeInfo.sessionId]) {
            return Promise.resolve(false);
        }

        const api = this.sessions[nodeInfo.sessionId];

        runClientRequest(async () => {
            try {
                const children = await api.getChildNodes(nodeInfo.nodePath ? nodeInfo.nodePath : undefined);

                this.onExpandCompletedEmitter.fire({
                    sessionId: nodeInfo.sessionId,
                    nodePath: nodeInfo.nodePath ?? "",
                    nodes: children.map(n => getObjectExplorerNodeInfo(n))
                });
            } catch (error) {
                this.onExpandCompletedEmitter.fire({
                    sessionId: nodeInfo.sessionId,
                    nodePath: nodeInfo.nodePath ?? "",
                    nodes: [],
                    errorMessage: error instanceof Error ? error.message : String(error)
                });
            }
        });

        return Promise.resolve(true);
    }

    refreshNode(nodeInfo: azdata.ExpandNodeInfo): Thenable<boolean> {
        return this.expandNode(nodeInfo);
    }

    findNodes(findNodesInfo: azdata.FindNodesInfo): Thenable<azdata.ObjectExplorerFindNodesResponse> {
        throw new Error('Method not implemented.');
    }

    registerOnSessionCreated(handler: (response: azdata.ObjectExplorerSession) => any): void {
        this.onSessionCreated(handler);
    }

    registerOnExpandCompleted(handler: (response: azdata.ObjectExplorerExpandInfo) => any): void {
        this.onExpandCompleted(handler);
    }
}

class RockMetadataProvider implements azdata.MetadataProvider {
    private handleId: number | undefined;

    public get handle(): number | undefined {
        return this.handleId;
    }
    public set handle(value: number | undefined) {
        this.handleId = value;
    }

    public readonly providerId: string = "magnus";

    public constructor() {

    }

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
}

class RockCapabilitiesServiceProvider implements azdata.CapabilitiesProvider {
    handle?: number | undefined;
    public get providerId() {
        return "magnus";
    }

    getServerCapabilities(client: azdata.DataProtocolClientCapabilities): Promise<azdata.DataProtocolServerCapabilities> {
        return Promise.resolve({
            protocolVersion: "1.0",
            providerName: "magnus",
            providerDisplayName: "Magnus",
            connectionProvider: {
                options: []
            },
            adminServicesProvider: <azdata.AdminServicesOptions>{},
            // This seems to let the export feature work.
            features: [
                {
                    enabled: true,
                    featureName: 'serializationService',
                    optionsMetadata: []
                }
            ],
        });
    }
}

// class RockCompletionItemProvider implements vscode.CompletionItemProvider<vscode.CompletionItem> {
//     provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList<vscode.CompletionItem>> {
//         if (position.character !== 4) {
//             return [];
//         }

//         const item: vscode.CompletionItem = {
//             label: "DefinedType"
//         };

//         return [
//             {
//                 label: "DefinedType"
//             },
//             {
//                 label: "DefinedValue"
//             }
//         ];
//     }
//     resolveCompletionItem?(item: vscode.CompletionItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem> {
//         return item;
//     }

// }

/**
 * This class needs to exist for server properties to be supported.
 */
class RockAdminServicesProvider implements azdata.AdminServicesProvider {
    public handle?: number | undefined;
    public get providerId(): string {
        return "magnus";
    };

    createDatabase(connectionUri: string, database: azdata.DatabaseInfo): Thenable<azdata.CreateDatabaseResponse> {
        throw new Error('Method not implemented.');
    }

    createLogin(connectionUri: string, login: azdata.LoginInfo): Thenable<azdata.CreateLoginResponse> {
        throw new Error('Method not implemented.');
    }

    getDefaultDatabaseInfo(connectionUri: string): Thenable<azdata.DatabaseInfo> {
        // This information provides the properties when looking at a single
        // database in the dashboard. But we don't have anything to show.
        return Promise.resolve({
            options: {}
        });
    }

    getDatabaseInfo(connectionUri: string): Thenable<azdata.DatabaseInfo> {
        return this.getDefaultDatabaseInfo(connectionUri);
    }

}

export function activate(context: vscode.ExtensionContext) {
    const connectionProvider = new ConnectionProvider();
    context.subscriptions.push(azdata.dataprotocol.registerConnectionProvider(connectionProvider));
    context.subscriptions.push(azdata.dataprotocol.registerQueryProvider(new QueryProvider(connectionProvider)));
    context.subscriptions.push(azdata.dataprotocol.registerObjectExplorerProvider(new ObjectExplorerProvider(connectionProvider)));
    context.subscriptions.push(azdata.dataprotocol.registerMetadataProvider(new RockMetadataProvider()));
    context.subscriptions.push(azdata.dataprotocol.registerCapabilitiesServiceProvider(new RockCapabilitiesServiceProvider()));
    context.subscriptions.push(azdata.dataprotocol.registerAdminServicesProvider(new RockAdminServicesProvider()));
    //context.subscriptions.push(vscode.languages.registerCompletionItemProvider("sql", new RockCompletionItemProvider(), ".", "-", ":", "\\", "[", "\""));
}

export function deactivate() {
}
