import * as azdata from 'azdata';
import { IExportSerializer, QueryColumn, QueryResultSet } from "../types";
import { Column, Workbook, Worksheet } from "exceljs";

/**
 * Serializer for exporting the result set data to Excel.
 */
export class ExporttoExcel implements IExportSerializer {
    private readonly filePath: string;

    private readonly workbook: Workbook;
    private readonly worksheet: Worksheet;

    constructor(request: azdata.SaveResultsRequestParams) {
        this.filePath = request.filePath;
        this.workbook = new Workbook();
        this.workbook.created = new Date();
        this.workbook.modified = new Date();
        this.worksheet = this.workbook.addWorksheet("Query Results");
    }

    async open(resultSet: QueryResultSet): Promise<void> {
        const columns: Column[] = [];

        resultSet.columns.forEach(c => {
            columns.push({
                header: c.name,
                key: c.name
            } as Column);
        });

        this.worksheet.columns = columns;
    }

    async close(): Promise<void> {
        await this.workbook.xlsx.writeFile(this.filePath);
    }

    writeRow(columns: QueryColumn[], row: unknown[]): Promise<void> {
        const data: Record<string, unknown> = {};

        for (let i = 0; i < row.length && i < columns.length; i++) {
            if (row[i] === null || row[i] === undefined) {
                data[columns[i].name] = null;
            }
            else {
                data[columns[i].name] = row[i];
            }
        }

        this.worksheet.addRow(data);

        return Promise.resolve();
    }
}
