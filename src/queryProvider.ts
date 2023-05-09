import * as azdata from "azdata";
import * as vscode from "vscode";
import { ConnectionProvider } from "./connectionProvider";
import { QueryRunner } from "./queryRunner";
import { runClientRequest, toElapsedString } from "./utils";
import { ExportToCsv } from "./serializers/exportToCsv";
import { IExportSerializer } from "./types";
import { ExportToJson } from "./serializers/exportToJson";

/**
 * The provider for running queries in Azure Data Studio.
 */
export class QueryProvider implements azdata.QueryProvider {
    // #region Properties

    public handle?: number | undefined;
    public readonly providerId: string = "magnus";

    private connectionProvider: ConnectionProvider;

    private activeQueries: Record<string, QueryRunner> = {};

    private onQueryComplete: vscode.EventEmitter<azdata.QueryExecuteCompleteNotificationResult> = new vscode.EventEmitter();
    private onResultSetAvailable: vscode.EventEmitter<azdata.QueryExecuteResultSetNotificationParams> = new vscode.EventEmitter();
    private onBatchStart: vscode.EventEmitter<azdata.QueryExecuteBatchNotificationParams> = new vscode.EventEmitter();
    private onBatchComplete: vscode.EventEmitter<azdata.QueryExecuteBatchNotificationParams> = new vscode.EventEmitter();
    private onMessage: vscode.EventEmitter<azdata.QueryExecuteMessageParams> = new vscode.EventEmitter();

    // #endregion

    /**
     * Creates a new instance of {@link QueryProvider}.
     * 
     * @param connectionProvider The connection provider to use when looking up connections.
     */
    public constructor(connectionProvider: ConnectionProvider) {
        this.connectionProvider = connectionProvider;
    }

    // #region QueryProvider Implementation

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
            batch.executionElapsed = toElapsedString(query.duration);

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
        const resultSet = query.getQueryResultSet(requestParams.resultSetIndex);
        let serializer: IExportSerializer | undefined;

        if (requestParams.resultFormat === "csv") {
            serializer = new ExportToCsv(requestParams);
        }
        else if (requestParams.resultFormat === "json") {
            serializer = new ExportToJson(requestParams);
        }

        if (serializer) {
            await serializer.open(resultSet);

            for (const row of resultSet.rows) {
                serializer.writeRow(resultSet.columns, row);
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

    // #endregion

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
