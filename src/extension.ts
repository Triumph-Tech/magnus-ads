import * as vscode from 'vscode';
import * as azdata from 'azdata';

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
        throw new Error('Method not implemented.');
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
    private onQueryComplete: vscode.EventEmitter<azdata.QueryExecuteCompleteNotificationResult> = new vscode.EventEmitter();
    private onResultSetAvailable: vscode.EventEmitter<azdata.QueryExecuteResultSetNotificationParams> = new vscode.EventEmitter();
    private onBatchStart: vscode.EventEmitter<azdata.QueryExecuteBatchNotificationParams> = new vscode.EventEmitter();
    private onBatchComplete: vscode.EventEmitter<azdata.QueryExecuteBatchNotificationParams> = new vscode.EventEmitter();

    public constructor(connectionProvider: ConnectionProvider) {
        this.connectionProvider = connectionProvider;
    }

    public connectionUriChanged(a: unknown, b: unknown): void {
        return;
    }

    cancelQuery(ownerUri: string): Promise<azdata.QueryCancelResult> {
        this.onQueryComplete.fire({
            ownerUri,
            batchSummaries: []
        });
        return Promise.resolve<azdata.QueryCancelResult>({
            messages: "Cancelled the query."
        });
        //throw new Error('Method not implemented.');
    }

    async runQuery(ownerUri: string, selection: azdata.ISelectionData | undefined, runOptions?: azdata.ExecutionPlanOptions | undefined): Promise<void> {
        const conn = await azdata.connection.getConnection(ownerUri);
        var doc = vscode.workspace.textDocuments.find(td => td.uri.toString() === ownerUri);

        setTimeout(() => {
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

            const resultSetSummary: azdata.ResultSetSummary = {
                id: 0,
                batchId: 0,
                rowCount: 2,
                columnInfo: [
                    <azdata.IDbColumn>{
                        columnName: "Name"
                    },
                    <azdata.IDbColumn>{
                        columnName: "Number"
                    },
                    <azdata.IDbColumn>{
                        columnName: "DateAndTime"
                    }
                ],
                complete: true
            };

            const batch: azdata.BatchSummary = <azdata.BatchSummary>{
                id: 0,
                selection: selection,
                executionStart: new Date().toISOString()
            };

            this.onBatchStart.fire({
                ownerUri,
                batchSummary: batch
            });

            this.onResultSetAvailable.fire({
                ownerUri,
                resultSetSummary: resultSetSummary
            });

            batch.executionEnd = new Date().toISOString();
            batch.executionElapsed = "00:00:02.289";
            batch.hasError = false;
            batch.resultSetSummaries = [resultSetSummary];

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
        return await Promise.resolve({
            message: "",
            resultSubset: {
                rowCount: 2,
                rows: [
                    [
                        {
                            displayValue: "Hello!",
                            isNull: false,
                            invariantCultureDisplayValue: "Hello!"
                        },
                        {
                            displayValue: "24",
                            isNull: false,
                            invariantCultureDisplayValue: "24"
                        },
                        {
                            displayValue: "2022-08-04T23:18:02.382",
                            isNull: false,
                            invariantCultureDisplayValue: "2022-08-04T23:18:02.382"
                        }
                    ],
                    [
                        {
                            displayValue: "Hello 2!",
                            isNull: false,
                            invariantCultureDisplayValue: "Hello!"
                        },
                        {
                            displayValue: "3",
                            isNull: false,
                            invariantCultureDisplayValue: "3"
                        },
                        {
                            displayValue: "",
                            isNull: true,
                            invariantCultureDisplayValue: ""
                        }
                    ]
                ]
            }
        });
    }
    disposeQuery(ownerUri: string): Thenable<void> {
        throw new Error('Method not implemented.');
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
        //throw new Error('Method not implemented.');
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

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "magnus" is now active!');

    const connectionProvider = new ConnectionProvider();
    context.subscriptions.push(azdata.dataprotocol.registerConnectionProvider(connectionProvider));
    context.subscriptions.push(azdata.dataprotocol.registerQueryProvider(new QueryProvider(connectionProvider)));
    context.subscriptions.push(azdata.dataprotocol.registerObjectExplorerProvider(new ObjectExplorerProvider()));
}

export function deactivate() {
}
