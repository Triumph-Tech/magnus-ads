import * as vscode from 'vscode';
import * as azdata from 'azdata';
import { QueryRunner } from './queryRunner';
import { ExportToCsv, ExportToJson, IExportSerializer } from './serializers/exportToCsv';
import { Commands } from './commands';
import { ConnectionProvider } from './connectionProvider';
import { runClientRequest } from './utils';
import { ObjectExplorerProvider } from './objectExplorerProvider';

function toElapsed(totalMilliseconds: number): string {
    const hours = Math.floor(totalMilliseconds / (1000 * 60 * 60));
    totalMilliseconds = totalMilliseconds % (1000 * 60 * 60);

    const minutes = Math.floor(totalMilliseconds / (1000 * 60));
    totalMilliseconds = totalMilliseconds % (1000 * 60);

    const seconds = Math.floor(totalMilliseconds / 1000);
    const milliseconds = totalMilliseconds % 1000;

    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
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
            batch.executionElapsed = toElapsed(query.duration);

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
    const commands = new Commands(context);

    context.subscriptions.push(commands);
    context.subscriptions.push(azdata.dataprotocol.registerConnectionProvider(connectionProvider));
    context.subscriptions.push(azdata.dataprotocol.registerQueryProvider(new QueryProvider(connectionProvider)));
    context.subscriptions.push(azdata.dataprotocol.registerObjectExplorerProvider(new ObjectExplorerProvider(connectionProvider, commands)));
    context.subscriptions.push(azdata.dataprotocol.registerMetadataProvider(new RockMetadataProvider()));
    context.subscriptions.push(azdata.dataprotocol.registerCapabilitiesServiceProvider(new RockCapabilitiesServiceProvider()));
    context.subscriptions.push(azdata.dataprotocol.registerAdminServicesProvider(new RockAdminServicesProvider()));
    //context.subscriptions.push(vscode.languages.registerCompletionItemProvider("sql", new RockCompletionItemProvider(), ".", "-", ":", "\\", "[", "\""));
}

export function deactivate() {
}
