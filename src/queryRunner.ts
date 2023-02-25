import * as azdata from 'azdata';
import { Api } from './api';
import { ExecuteQueryResult, QueryColumn, QueryMessage } from './types';

export class QueryRunner {
    private connection: azdata.connection.ConnectionProfile;
    private query: string;
    private cancelled: boolean = false;
    private result?: ExecuteQueryResult;

    constructor(connection: azdata.connection.ConnectionProfile, query: string) {
        this.connection = connection;
        this.query = query;
    }

    public async execute(): Promise<void> {
        const api = new Api(this.connection.serverName, this.connection.userName, this.connection.password);

        this.result = await api.executeQuery(this.query);
    }

    public cancel(): void {
        this.cancelled = true;
    }

    public isCancelled(): boolean {
        return this.cancelled;
    }

    public getMessages(): QueryMessage[] {
        if (!this.result) {
            throw new Error("Query has not completed.");
        }

        return this.result.messages;
    }

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
                rows: resultSet.rows.slice(startRow, startRow + count).map(r => this.getRow(r))
            }
        };
    }

    private getColumns(resultSetColumns: QueryColumn[]): azdata.IDbColumn[] {
        return resultSetColumns.map(c => <azdata.IDbColumn>{
            columnName: c.name
        });
    }

    private getRow(row: unknown[]): azdata.DbCellValue[] {
        return row.map(c => {
            if (c === null || c === undefined) {
                return {
                    displayValue: "",
                    isNull: true,
                    invariantCultureDisplayValue: ""
                };
            }
            else {
                return {
                    displayValue: String(c),
                    isNull: false,
                    invariantCultureDisplayValue: String(c)
                };
            }
        });
    }
}
