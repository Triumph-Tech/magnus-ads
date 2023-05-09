import * as azdata from 'azdata';
import { promises as fs } from 'fs';
import { IExportSerializer, QueryColumn, QueryResultSet } from "../types";

/**
 * Serializer for exporting the result set data to JSON.
 */
export class ExportToJson implements IExportSerializer {
    private readonly filePath: string;

    private stream: fs.FileHandle | undefined;

    private columnNames: string[] = [];

    private dataObject: Record<string, unknown>[] = [];

    constructor(request: azdata.SaveResultsRequestParams) {
        this.filePath = request.filePath;
    }

    async open(resultSet: QueryResultSet): Promise<void> {
        this.columnNames = resultSet.columns.map(c => c.name);
        this.stream = await fs.open(this.filePath, "w");
    }

    async close(): Promise<void> {
        if (this.stream) {
            await this.stream.write(JSON.stringify(this.dataObject, undefined, 2));

            await this.stream.close();
            this.stream = undefined;
        }
    }

    writeRow(columns: QueryColumn[], row: unknown[]): Promise<void> {
        const data: Record<string, unknown> = {};

        for (let i = 0; i < row.length && i < this.columnNames.length; i++) {
            if (row[i] === null || row[i] === undefined) {
                data[this.columnNames[i]] = null;
            }
            else {
                data[this.columnNames[i]] = row[i];
            }
        }
        this.dataObject.push(data);

        return Promise.resolve();
    }
}
