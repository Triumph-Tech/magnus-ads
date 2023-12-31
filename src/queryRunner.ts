import * as azdata from 'azdata';
import { AbortController } from "abort-controller";
import { Api } from './api';
import { ExecuteQueryProgress, QueryColumn, QueryMessage, QueryResultSet } from './types';
import { getCellDisplayValue } from './utils';

/**
 * Handles all the processing and logic of executing a query on the Rock server.
 */
export class QueryRunner {
    // #region Properties

    private api: Api;
    private query: string;
    private cancelled: boolean = false;
    private result?: ExecuteQueryProgress;
    private abortController: AbortController;

    // #endregion

    /**
     * Creates a new instance of {@link QueryRunner}.
     * 
     * @param api The Api object to use when communicating with the server.
     * @param query The text of the query to be executed.
     */
    constructor(api: Api, query: string) {
        this.api = api;
        this.query = query;
        this.abortController = new AbortController();
    }

    // #region Property Accessors

    /**
     * The duration of the query in milliseconds. This is the time it took the
     * query to execute, not the entire request.
     */
    public get duration(): number {
        return this.result?.duration ?? 0;
    }

    // #endregion

    // #region Functions

    /**
     * Executes the query asynchronously.
     * 
     * @param messageCallback A function to be called when messages are recieved while the query is running.
     * 
     * @returns A promise that will be resolved when the query has completed.
     */
    public async execute(messageCallback: (message: QueryMessage) => void): Promise<void> {
        this.result = await this.api.executeQuery(this.query, messageCallback, this.abortController.signal);
    }

    /**
     * Requests that the query be cancelled.
     */
    public cancel(): void {
        this.cancelled = true;
        this.abortController.abort();
    }

    /**
     * Checks if the query has been cancelled already.
     * 
     * @returns `true` if the query was previously cancelled; otherwise `false`.
     */
    public isCancelled(): boolean {
        return this.cancelled;
    }

    /**
     * Gets any messages that were generated by the query.
     * 
     * @returns An array of messages generated during the query.
     */
    public getMessages(): QueryMessage[] {
        if (!this.result) {
            throw new Error("Query has not completed.");
        }

        return this.result.messages;
    }

    /**
     * Gets the number of result sets returned by the query.
     * 
     * @returns The number of result sets.
     */
    public getResultSetCount(): number {
        if (!this.result) {
            throw new Error("Query has not completed.");
        }

        return this.result.resultSets?.length ?? 0;
    }

    /**
     * Gets the raw query result set from the query.
     * 
     * @param resultSet The index of the result set to be retrieved.
     * 
     * @returns The query result set.
     */
    public getQueryResultSet(resultSet: number): QueryResultSet {
        if (!this.result) {
            throw new Error("Query has not completed.");
        }

        if (!this.result.resultSets || resultSet >= this.result.resultSets.length) {
            throw new Error("Invalid result set specified.");
        }

        return this.result.resultSets[resultSet];
    }

    /**
     * Gets the result set summary objects.
     * 
     * @returns The summary objects describing the result sets for the query.
     */
    public getResultSetSummaries(): azdata.ResultSetSummary[] {
        const summaries: azdata.ResultSetSummary[] = [];
        let summaryId = 0;

        if (!this.result) {
            throw new Error("Query has not completed.");
        }

        if (!this.result.resultSets) {
            return summaries;
        }

        for (let i = 0; i < this.result.resultSets.length; i++) {
            const resultSet = this.result.resultSets[i];
            const summary: azdata.ResultSetSummary = {
                id: summaryId++,
                batchId: 0,
                rowCount: resultSet.rows.length,
                columnInfo: this.getColumns(resultSet.columns),
                complete: true
            };

            summaries.push(summary);
        }

        return summaries;
    }

    /**
     * Gets part of the result set of a query.
     * 
     * @param resultSetIndex The index of the result set.
     * @param startRow The first row of data to be retrieved.
     * @param count The number of rows to be retrieved.
     * 
     * @returns An object that describes the subset of the result.
     */
    public getResultSet(resultSetIndex: number, startRow: number, count: number): azdata.QueryExecuteSubsetResult {
        if (!this.result) {
            throw new Error("Query has not completed.");
        }

        if (!this.result.resultSets || resultSetIndex > this.result.resultSets.length) {
            throw new Error("Result set was not found.");
        }

        const resultSet = this.result.resultSets[resultSetIndex];

        if (startRow + count > resultSet.rows.length) {
            throw new Error("Requested rows do not exist.");
        }

        return {
            message: "",
            resultSubset: {
                rowCount: count,
                rows: resultSet.rows.slice(startRow, startRow + count).map(r => this.getRow(resultSet.columns, r))
            }
        };
    }

    /**
     * Gets the columns that can be passed to ADS.
     * 
     * @param resultSetColumns The columns to be converted to ADS format.
     * 
     * @returns An array of columns in a format ADS expects.
     */
    private getColumns(resultSetColumns: QueryColumn[]): azdata.IDbColumn[] {
        return resultSetColumns.map(c => <azdata.IDbColumn>{
            columnName: c.name
        });
    }

    /**
     * Gets the row of data that can be passed to ADS.
     * 
     * @param columns The columns that correspond to the row data.
     * @param row The row to be converted.
     * @returns An array of cells in a format that ADS expects.
     */
    private getRow(columns: QueryColumn[], row: unknown[]): azdata.DbCellValue[] {
        return row.map((c, index) => {
            if (c === null || c === undefined) {
                return {
                    displayValue: "",
                    isNull: true,
                    invariantCultureDisplayValue: ""
                };
            }
            else {
                const value = getCellDisplayValue(columns[index].type, c);

                return {
                    displayValue: value,
                    isNull: false,
                    invariantCultureDisplayValue: value
                };
            }
        });
    }
}
