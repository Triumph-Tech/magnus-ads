import * as azdata from 'azdata';
import { promises as fs } from 'fs';
import { EOL } from 'os';
import { IExportSerializer, QueryColumn, QueryResultSet } from '../types';
import { getCellDisplayValue } from '../utils';

/**
 * Serializer for exporting the result set data to CSV.
 */
export class ExportToCsv implements IExportSerializer {
    private readonly filePath: string;

    private readonly includeHeaders: boolean;

    private readonly delimiter: string;

    private readonly lineSeperator: string;

    private readonly textIdentifier: string;

    private readonly encoding: "ascii" | "utf8" | "utf-8" | "utf16le";

    private stream: fs.FileHandle | undefined;

    constructor(request: azdata.SaveResultsRequestParams) {
        this.filePath = request.filePath;
        this.includeHeaders = request.includeHeaders ?? false;
        this.delimiter = request.delimiter ?? ",";
        this.lineSeperator = request.lineSeperator ?? EOL;
        this.textIdentifier = request.textIdentifier ?? "\"";
        if (request.encoding === "ascii" || request.encoding === "utf8" || request.encoding === "utf-8" || request.encoding === "utf16le") {
            this.encoding = request.encoding;
        }
        else {
            this.encoding = "utf-8";
        }
    }

    public async open(resultSet: QueryResultSet): Promise<void> {
        this.stream = await fs.open(this.filePath, "w");

        if (this.includeHeaders) {
            const headers = resultSet.columns.map(c => this.encodeValue(c.name));
            const line = headers.join(this.delimiter) + this.lineSeperator;

            await this.stream.write(Buffer.from(line, this.encoding));
        }
    }

    public async close(): Promise<void> {
        if (this.stream) {
            await this.stream.close();
            this.stream = undefined;
        }
    }

    public async writeRow(columns: QueryColumn[], row: unknown[]): Promise<void> {
        if (!this.stream) {
            return;
        }

        const fields = row.map((f, idx): string => {
            if (f === null || f === undefined) {
                return this.encodeValue(null);
            }
            else {
                return this.encodeValue(getCellDisplayValue(columns[idx].type, f));
            }
        });
 
        const line = fields.join(this.delimiter) + this.lineSeperator;
        
        await this.stream.write(Buffer.from(line, this.encoding));
    }

    private encodeValue(value: string | null): string {
        if (value === null) {
            return "NULL";
        }

        let text = value;

        // Fix any inline quotes.
        text = text.replace(new RegExp(`/\\${this.textIdentifier}/g`), `${this.textIdentifier}${this.textIdentifier}`);

        const needWrap = text.indexOf(this.delimiter) !== -1
            || text.indexOf("\r") !== -1
            || text.indexOf("\n") !== -1
            || text.indexOf(this.textIdentifier) !== -1
            || text.startsWith(" ")
            || text.endsWith(" ")
            || text.startsWith("\t")
            || text.endsWith("\t");
        
        if (needWrap) {
            return `${this.textIdentifier}${text}${this.textIdentifier}`;
        }
        else {
            return text;
        }
    }
}
