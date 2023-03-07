import * as vscode from 'vscode';
import * as azdata from 'azdata';
import { QueryRunner } from './queryRunner';

function toElapsed(totalMilliseconds: number): string {
    const hours = Math.floor(totalMilliseconds / (1000 * 60 * 60));
    totalMilliseconds = totalMilliseconds % (1000 * 60 * 60);

    const minutes = Math.floor(totalMilliseconds / (1000 * 60));
    totalMilliseconds = totalMilliseconds % (1000 * 60);

    const seconds = Math.floor(totalMilliseconds / 1000);
    const milliseconds = totalMilliseconds % 1000;

    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`
}

class ConnectionProvider implements azdata.ConnectionProvider {
    handle?: number | undefined;
    public readonly providerId: string = "magnus";

    private onConnectionComplete: vscode.EventEmitter<azdata.ConnectionInfoSummary> = new vscode.EventEmitter();

    async connect(connectionUri: string, connectionInfo: azdata.ConnectionInfo): Promise<boolean> {
        this.onConnectionComplete.fire({
            connectionId: "123",
            ownerUri: connectionUri,
            messages: "",
            errorMessage: "",
            errorNumber: 0,
            connectionSummary: {
                serverName: connectionInfo.options["server"],
                databaseName: "Rock",
                userName: connectionInfo.options["username"]
            },
            serverInfo: {
                serverReleaseVersion: 1,
                engineEditionId: 1,
                serverVersion: "1.0",
                serverLevel: "",
                serverEdition: "",
                isCloud: true,
                azureVersion: 1,
                osVersion: "",
                options: {}
            }
        });

        return Promise.resolve(true);
    }

    disconnect(connectionUri: string): Thenable<boolean> {
        throw new Error('Method not implemented.');
    }

    cancelConnect(connectionUri: string): Thenable<boolean> {
        throw new Error('Method not implemented.');
    }

    listDatabases(connectionUri: string): Thenable<azdata.ListDatabasesResult> {
        return Promise.resolve({
            databaseNames: ["Rock"]
        });
    }

    changeDatabase(connectionUri: string, newDatabase: string): Thenable<boolean> {
        return Promise.resolve(true);
    }

    rebuildIntelliSenseCache(connectionUri: string): Thenable<void> {
        throw new Error('Method not implemented.');
    }

    getConnectionString(connectionUri: string, includePassword: boolean): Thenable<string> {
        throw new Error('Method not implemented.');
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

    public connectionUriChanged(a: unknown, b: unknown): void {
        return;
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
        var doc = vscode.workspace.textDocuments.find(td => td.uri.toString() === ownerUri);

        setTimeout(async () => {
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

            const query = new QueryRunner(conn, text);
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
        }, 0);
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

    saveResults(requestParams: azdata.SaveResultsRequestParams): Thenable<azdata.SaveResultRequestResult> {
        throw new Error('Method not implemented.');
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
}

class ObjectExplorerProvider implements azdata.ObjectExplorerProvider {
    private nextSessionId: number = 1;
    handle?: number | undefined;
    public readonly providerId: string = "magnus";

    private onSessionCreatedEmitter: vscode.EventEmitter<azdata.ObjectExplorerSession> = new vscode.EventEmitter();
    private onSessionCreated: vscode.Event<azdata.ObjectExplorerSession> = this.onSessionCreatedEmitter.event;

    private expandCompleted?: (response: azdata.ObjectExplorerExpandInfo) => void;

    public createNewSession(connInfo: azdata.ConnectionInfo): Promise<azdata.ObjectExplorerSessionResponse> {
        console.log("createNewSession");

        const sessionId = this.nextSessionId.toString();
        this.nextSessionId++;

        // If this runs before we return it seems ADS does not recognize that we
        // actually created a session.
        setTimeout(() => {
            console.log(`onSessionCreated sessionId ${sessionId}`);
            this.onSessionCreatedEmitter.fire({
                success: true,
                sessionId: sessionId,
                rootNode: {
                    nodePath: "",
                    nodeType: "server",
                    label: "Rock Server",
                    isLeaf: false
                }
            });
        }, 1);

        return Promise.resolve({
            sessionId: sessionId
        });
    }

    closeSession(closeSessionInfo: azdata.ObjectExplorerCloseSessionInfo): Thenable<azdata.ObjectExplorerCloseSessionResponse> {
        throw new Error('Method not implemented.');
    }

    public expandNode(nodeInfo: azdata.ExpandNodeInfo): Promise<boolean> {
        console.log(`expandNode on session ${nodeInfo.sessionId}`);

        if (!nodeInfo.sessionId) {
            return Promise.resolve(false);
        }

        if (this.expandCompleted) {
            console.log(`expandCompleted on session ${nodeInfo.sessionId}`);
            this.expandCompleted({
                sessionId: nodeInfo.sessionId,
                nodePath: nodeInfo.nodePath ?? "",
                nodes: [
                    {
                        nodePath: nodeInfo.nodePath + "/tables",
                        nodeType: "",
                        label: "Tables",
                        isLeaf: true
                    }
                ]
            });
        }

        return Promise.resolve(true);
    }

    refreshNode(nodeInfo: azdata.ExpandNodeInfo): Thenable<boolean> {
        throw new Error('Method not implemented.');
    }
    findNodes(findNodesInfo: azdata.FindNodesInfo): Thenable<azdata.ObjectExplorerFindNodesResponse> {
        throw new Error('Method not implemented.');
    }

    registerOnSessionCreated(handler: (response: azdata.ObjectExplorerSession) => any): void {
        console.log("registerOnSessionCreated");
        this.onSessionCreated(e => handler(e));
    }

    registerOnExpandCompleted(handler: (response: azdata.ObjectExplorerExpandInfo) => any): void {
        console.log("registerOnExpandCompleted");
        this.expandCompleted = handler;
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
        throw new Error('Method not implemented.');
    }
    getDatabases(connectionUri: string): Thenable<string[] | azdata.DatabaseInfo[]> {
        return Promise.resolve(["Rock"]);
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

class RockCompletionItemProvider implements vscode.CompletionItemProvider<vscode.CompletionItem> {
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList<vscode.CompletionItem>> {
        if (position.character !== 4) {
            return [];
        }

        const item: vscode.CompletionItem = {
            label: "DefinedType"
        };

        return [
            {
                label: "DefinedType"
            },
            {
                label: "DefinedValue"
            }
        ];
    }
    resolveCompletionItem?(item: vscode.CompletionItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem> {
        return item;
    }

}

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "magnus" is now active!');

    const connectionProvider = new ConnectionProvider();
    context.subscriptions.push(azdata.dataprotocol.registerConnectionProvider(connectionProvider));
    context.subscriptions.push(azdata.dataprotocol.registerQueryProvider(new QueryProvider(connectionProvider)));
    context.subscriptions.push(azdata.dataprotocol.registerObjectExplorerProvider(new ObjectExplorerProvider()));
    context.subscriptions.push(azdata.dataprotocol.registerMetadataProvider(new RockMetadataProvider()));
    context.subscriptions.push(azdata.dataprotocol.registerCapabilitiesServiceProvider(new RockCapabilitiesServiceProvider()));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider("sql", new RockCompletionItemProvider(), ".", "-", ":", "\\", "[", "\""));
}

export function deactivate() {
}
